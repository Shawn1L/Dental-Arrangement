@echo off
cd /d "%~dp0"
echo Local dental segmentation service: http://127.0.0.1:5187
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-service.ps1"
pause
