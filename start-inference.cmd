@echo off
cd /d "%~dp0"
echo Local dental segmentation service: http://127.0.0.1:5187
python -m uvicorn app:app --app-dir server --host 127.0.0.1 --port 5187
pause
