import gzip
import subprocess
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
import app


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


if __name__ == '__main__':
    unittest.main()
