import gzip
import subprocess
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
import app
import struct
import numpy as np
from refinement.service import STRONG, decode_mesh


class AdapterTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app.app)

    def test_invalid_request_never_calls_remote(self):
        with patch('app.subprocess.run') as remote:
            self.assertEqual(self.client.post('/api/segmentation?jaw=other', content=b'0' * 36).status_code, 400)
            self.assertEqual(self.client.post('/api/segmentation?jaw=upper', content=b'broken').status_code, 400)
            remote.assert_not_called()

    def test_busy_service_does_not_launch_another_gpu_job(self):
        app.lock.acquire()
        try:
            with patch('app.subprocess.run') as remote:
                self.assertEqual(self.client.post('/api/segmentation?jaw=upper', content=b'0' * 36).status_code, 409)
                remote.assert_not_called()
        finally:
            app.lock.release()

    def test_compressed_input_and_result_validation(self):
        payload = b'0' * 36
        output = b'upstream log\nSTL_STUDIO_RESULT={"labels":[11,11,0],"jaw":"upper"}\n'
        with patch('app.subprocess.run', return_value=subprocess.CompletedProcess([], 0, output, b'')) as remote:
            response = self.client.post('/api/segmentation?jaw=upper', content=payload)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['labels'], [11, 11, 0])
            self.assertEqual(gzip.decompress(remote.call_args.kwargs['input']), payload)
        with patch('app.subprocess.run', return_value=subprocess.CompletedProcess([], 0, b'STL_STUDIO_RESULT={"labels":[11]}', b'')):
            self.assertEqual(self.client.post('/api/segmentation?jaw=upper', content=payload).status_code, 503)
        self.assertFalse(app.lock.locked())

    def test_refinement_is_local_and_binary(self):
        vertices = np.array([[0,0,0],[10,0,0],[0,10,0]], dtype='<f4')
        payload = struct.pack('<III',1,3,1)+vertices.tobytes()+np.array([[0,1,2]],dtype='<u4').tobytes()+np.array([0,11,11],dtype='<u2').tobytes()
        with patch('app.predict') as remote:
            response = self.client.post('/api/segmentation/refine',content=payload)
            self.assertEqual(response.status_code,200,response.text)
            remote.assert_not_called()
        size = struct.unpack_from('<I',response.content)[0]
        import json
        header=json.loads(response.content[4:4+size])
        self.assertEqual(header['report']['settings'],STRONG)
        self.assertLess(header['report']['max_face_area_relative_error'],1e-7)
        labels=np.frombuffer(response.content,'<u2',offset=4+size+header['faces']*72)
        self.assertEqual(set(labels),{0,11})

    def test_refinement_rejects_invalid_binary_before_processing(self):
        with patch('app.predict') as remote:
            self.assertEqual(self.client.post('/api/segmentation/refine',content=b'broken').status_code,400)
            remote.assert_not_called()
        v=np.array([[0,0,0],[1,0,0],[0,1,0]],dtype='<f4')
        def payload(vertices=v,faces=(0,1,2),labels=(0,11,11)):
            return struct.pack('<III',1,3,1)+vertices.tobytes()+np.array(faces,dtype='<u4').tobytes()+np.array(labels,dtype='<u2').tobytes()
        for data in [payload(faces=(0,1,3)),payload(labels=(0,19,11)),payload(vertices=v*np.nan),payload(faces=(0,0,1)),payload()[:-1]]:
            with self.assertRaises(ValueError):decode_mesh(data)


if __name__ == '__main__':
    unittest.main()
