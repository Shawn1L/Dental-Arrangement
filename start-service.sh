#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

python_bin="${PYTHON_BIN:-python3}"
command -v "$python_bin" >/dev/null || { echo 'Python 3.11+ is required.' >&2; exit 1; }
if [[ "${1:-}" == '--check' ]]; then
    exec "$python_bin" scripts/service-health.py
fi
if [[ $# -ne 0 ]]; then
    echo 'Usage: bash start-service.sh [--check]' >&2
    exit 1
fi
"$python_bin" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else "Python 3.11+ is required.")'
venv_dir="${DENTAL_VENV:-.venv-linux}"
if [[ ! -x "$venv_dir/bin/python" ]]; then
    "$python_bin" -m venv "$venv_dir"
fi
service_python="$venv_dir/bin/python"
if ! "$service_python" -c 'import fastapi, uvicorn, numpy, scipy, trimesh, rtree, httpx' 2>/dev/null; then
    "$service_python" -m pip install -r server/requirements.txt
fi
health=0
"$service_python" scripts/service-health.py || health=$?
if [[ $health -eq 0 ]]; then
    echo 'The current Python service is already running.'
    exit 0
elif [[ $health -ne 1 ]]; then
    echo 'An older or different service is using this address. Stop it before restarting.' >&2
    exit 1
fi
exec "$service_python" -m uvicorn app:app --app-dir server \
    --host "${DENTAL_SERVICE_HOST:-127.0.0.1}" --port "${DENTAL_SERVICE_PORT:-5187}"
