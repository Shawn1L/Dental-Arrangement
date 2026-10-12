@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22.12 or newer.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm.cmd ci
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-service.ps1"
if errorlevel 1 (
  pause
  exit /b 1
)
echo Open http://127.0.0.1:5186 in your browser.
call npm.cmd run dev
pause
