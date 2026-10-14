#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
mode="${1:-dev}"
if [[ $# -gt 1 || ( "$mode" != dev && "$mode" != preview ) ]]; then
    echo 'Usage: bash start.sh [dev|preview]' >&2
    exit 1
fi
for executable in node npm setsid; do
    command -v "$executable" >/dev/null || { echo "Missing command: $executable" >&2; exit 1; }
done
node --input-type=module -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (!(major === 20 && minor >= 19 || major === 22 && minor >= 12 || major > 22)) { console.error("Node.js 20.19+ or 22.12+ is required."); process.exit(1); }'
if [[ ! -d node_modules ]]; then
    npm ci
fi
if [[ "$mode" == preview ]]; then
    npm run build
fi

service_pid=''
frontend_pid=''
cleanup() {
    trap - EXIT INT TERM
    if [[ -n "$frontend_pid" ]]; then
        kill -TERM -- "-$frontend_pid" 2>/dev/null || true
        wait "$frontend_pid" 2>/dev/null || true
    fi
    if [[ -n "$service_pid" ]]; then
        kill -TERM -- "-$service_pid" 2>/dev/null || true
        wait "$service_pid" 2>/dev/null || true
    fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
health=0
bash ./start-service.sh --check || health=$?
if [[ $health -eq 1 ]]; then
    setsid bash ./start-service.sh >service.log 2>service-error.log &
    service_pid=$!
    ready=false
    # First-run dependency installation may take several minutes.
    for ((attempt=0; attempt<600; attempt++)); do
        if ! kill -0 "$service_pid" 2>/dev/null; then
            echo 'Python service exited. Check service.log and service-error.log.' >&2
            exit 1
        fi
        health=0
        bash ./start-service.sh --check || health=$?
        if [[ $health -eq 0 ]]; then ready=true; break; fi
        if [[ $health -ne 1 ]]; then
            echo 'An older or different service is using the Python service address.' >&2
            exit 1
        fi
        sleep 1
    done
    if [[ "$ready" != true ]]; then
        echo 'Python service startup timed out. Check service-error.log.' >&2
        exit 1
    fi
elif [[ $health -ne 0 ]]; then
    echo 'Cannot use the Python service. Check Python 3.11+ and stop any older service.' >&2
    exit 1
fi

api_host="${DENTAL_SERVICE_HOST:-127.0.0.1}"
if [[ "$api_host" == '0.0.0.0' ]]; then api_host='127.0.0.1'; fi
if [[ "$api_host" == '::' ]]; then api_host='::1'; fi
if [[ "$api_host" == *:* ]]; then api_host="[$api_host]"; fi
export DENTAL_API_TARGET="${DENTAL_API_TARGET:-http://$api_host:${DENTAL_SERVICE_PORT:-5187}}"
port="${PORT:-5186}"
if [[ "$mode" == preview ]]; then port="${PORT:-4186}"; fi
echo "STL Studio: http://${HOST:-127.0.0.1}:$port (Ctrl+C to stop)"
setsid npm run "$mode" -- --host "${HOST:-127.0.0.1}" --port "$port" &
frontend_pid=$!
wait "$frontend_pid"
