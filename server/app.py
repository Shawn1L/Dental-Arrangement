"""Local bridge to the authorized customer Docker inference environment."""
import base64
import gzip
import os
import json
import shlex
import subprocess
import threading
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from starlette.concurrency import run_in_threadpool

app = FastAPI()
lock = threading.Lock()
HOST = os.environ.get('DENTAL_SSH_HOST', 'AI牙科客户服务器')
CONTAINER = os.environ.get('DENTAL_CONTAINER', 'tooth-3d')
ROOT = os.environ.get('DENTAL_MODEL_ROOT', '/home/yidong/ai-dental-orth/pathology_analysis/inference')
PYTHON = os.environ.get('DENTAL_REMOTE_PYTHON', '/opt/conda/envs/tgn/bin/python')
MAX_BYTES = 150 * 1024 * 1024
MARKER = b'STL_STUDIO_RESULT='


def predict(data, jaw):
    if not lock.acquire(blocking=False):
        raise HTTPException(409, '分牙服务正在处理另一模型，请稍后重试')
    try:
        source = Path(__file__).with_name('remote_runner.py').read_text(encoding='utf-8')
        source += f'\nrun({ROOT!r}, {jaw!r})\n'
        encoded = base64.b64encode(source.encode()).decode('ascii')
        code = f"import base64;exec(base64.b64decode('{encoded}'))"
        command = shlex.join(['docker', 'exec', '-i', CONTAINER, PYTHON, '-c', code])
        result = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=30', HOST, command],
                                input=gzip.compress(data), capture_output=True, timeout=600)
        if result.returncode or MARKER not in result.stdout:
            detail = result.stderr.decode('utf-8', errors='replace').strip().splitlines()
            raise RuntimeError(detail[-1] if detail else '远程推理未返回结果')
        output = json.loads(result.stdout.rsplit(MARKER, 1)[1])
        labels = output.get('labels')
        if not isinstance(labels, list) or len(labels) != len(data) // 12:
            raise RuntimeError('远程推理标签数量与上传模型不一致')
        return output
    except subprocess.TimeoutExpired as error:
        raise HTTPException(504, '远程分牙超时，请稍后重试') from error
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(503, f'自动分牙失败：{error}') from error
    finally:
        lock.release()


@app.get('/api/segmentation/health')
def health():
    return {'backend': 'customer-container', 'busy': lock.locked()}


@app.post('/api/segmentation')
async def segment(request: Request, jaw: str):
    if jaw not in ('upper', 'lower'):
        raise HTTPException(400, '请先指定模型所属上颌或下颌')
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > MAX_BYTES:
            raise HTTPException(413, '模型超过 150 MB')
    if not data or len(data) % 36:
        raise HTTPException(400, '需要 Float32 三角面顶点数据')
    return await run_in_threadpool(predict, data, jaw)
