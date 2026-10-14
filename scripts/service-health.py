"""Check the local service without importing third-party dependencies.

Exit codes: 0 = current service, 1 = unreachable, 2 = different/old service.
"""
import hashlib
import json
import os
from pathlib import Path
import sys
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, build_opener

root = Path(__file__).resolve().parent.parent / 'server'
files = [root / 'app.py', *sorted((root / 'refinement').glob('*.py'))]
revision = hashlib.sha256(b''.join(path.read_bytes() for path in files)).hexdigest()
host = os.environ.get('DENTAL_SERVICE_HOST', '127.0.0.1')
if host in ('0.0.0.0', '::'):
    host = '127.0.0.1' if host == '0.0.0.0' else '::1'
if ':' in host:
    host = f'[{host}]'
port = os.environ.get('DENTAL_SERVICE_PORT', '5187')
try:
    # Local health checks must not go through an HTTP proxy.
    with build_opener(ProxyHandler({})).open(
        f'http://{host}:{port}/api/segmentation/refine/health', timeout=2
    ) as response:
        health = json.load(response)
except HTTPError:
    sys.exit(2)
except (URLError, TimeoutError, OSError):
    sys.exit(1)
except (ValueError, UnicodeError):
    sys.exit(2)
sys.exit(0 if isinstance(health, dict) and health.get('preset') == 'strong'
         and health.get('backend') == 'local-python'
         and health.get('revision') == revision else 2)
