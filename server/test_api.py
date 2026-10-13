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
        self.assertGreaterEqual(float(response.headers['X-Refinement-Queue-Seconds']),0)
        self.assertGreaterEqual(float(response.headers['X-Refinement-Compute-Seconds']),0)
        self.assertEqual(set(header['report']['stage_seconds']),{'island_cleanup','interface_extract','curve_smoothing','field_solve','partition','validation'})
        self.assertEqual(self.client.get('/api/segmentation/refine/health').json()['revision'],app.SOURCE_REVISION)
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

    def test_refinement_filters_bad_faces_and_preserves_valid_surface(self):
        import json
        vertices = np.array([[0,0,0],[10,0,0],[0,10,0],[20,0,0],
                             [0,0,0],[1e-13,0,0]], dtype='<f4')
        labels = np.array([0,11,11,11,0,0], dtype='<u2')
        # Valid triangle, repeated vertex, collinear triangle, and tiny edge.
        faces = np.array([[0,1,2],[3,3,1],[0,1,3],[4,5,2]], dtype='<u4')
        payload = struct.pack('<III',1,len(vertices),len(faces))+vertices.tobytes()+faces.tobytes()+labels.tobytes()
        v, f, ids, cleanup = decode_mesh(payload, with_report=True)
        np.testing.assert_array_equal(v, vertices[:3])
        np.testing.assert_array_equal(f, [[0,1,2]])
        np.testing.assert_array_equal(ids, labels[:3])
        self.assertEqual(cleanup['filtered_degenerate_faces'], 3)
        self.assertEqual(cleanup['removed_unreferenced_vertices'], 3)
        clean = struct.pack('<III',1,3,1)+vertices[:3].tobytes()+faces[:1].tobytes()+labels[:3].tobytes()
        with patch('app.predict') as remote:
            response = self.client.post('/api/segmentation/refine', content=payload)
            baseline = self.client.post('/api/segmentation/refine', content=clean)
            remote.assert_not_called()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(baseline.status_code, 200, baseline.text)
        size = struct.unpack_from('<I', response.content)[0]
        baseline_size = struct.unpack_from('<I', baseline.content)[0]
        self.assertEqual(response.content[4+size:], baseline.content[4+baseline_size:])
        report = json.loads(response.content[4:4+size])['report']
        self.assertEqual(report['input_faces'], 4)
        self.assertEqual(report['source_faces'], 1)
        self.assertEqual(report['filtered_degenerate_faces'], 3)

    def test_refinement_compacts_indices_and_rejects_loss_of_tooth(self):
        vertices = np.array([[99,99,99],[0,0,0],[10,0,0],[0,10,0]], dtype='<f4')
        faces = np.array([[1,2,3],[0,0,0]], dtype='<u4')
        def payload(labels):
            return struct.pack('<III',1,4,2)+vertices.tobytes()+faces.tobytes()+np.array(labels,dtype='<u2').tobytes()
        v, f, labels = decode_mesh(payload([11,0,11,11]))
        np.testing.assert_array_equal(v, vertices[1:])
        np.testing.assert_array_equal(f, [[0,1,2]])
        np.testing.assert_array_equal(labels, [0,11,11])
        with self.assertRaisesRegex(ValueError, '牙号丢失：12'):
            decode_mesh(payload([12,0,11,11]))
        response = self.client.post('/api/segmentation/refine', content=payload([12,0,11,11]))
        self.assertEqual(response.status_code, 400)


if __name__ == '__main__':
    unittest.main()
