$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$taskPython = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (!(Test-Path -LiteralPath $taskPython)) {
    & python -m venv --system-site-packages .venv
    if ($LASTEXITCODE -ne 0) { throw 'Failed to create Python environment.' }
}
$ErrorActionPreference = 'Continue'
& $taskPython -c 'import fastapi,uvicorn,numpy,scipy,trimesh,rtree,httpx' 2>$null
$taskImportExit = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($taskImportExit -ne 0) {
    & $taskPython -m pip install -r server/requirements.txt
    if ($LASTEXITCODE -ne 0) { throw 'Failed to install Python dependencies.' }
}
try {
    $taskHealth = Invoke-RestMethod 'http://127.0.0.1:5187/api/segmentation/refine/health' -TimeoutSec 2
    if ($taskHealth.preset -eq 'strong') { exit 0 }
} catch {}
Start-Process -FilePath $taskPython -ArgumentList '-m uvicorn app:app --app-dir server --host 127.0.0.1 --port 5187' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PSScriptRoot 'service.log') -RedirectStandardError (Join-Path $PSScriptRoot 'service-error.log')
for ($taskAttempt = 0; $taskAttempt -lt 30; $taskAttempt++) {
    Start-Sleep -Milliseconds 500
    try {
        $taskHealth = Invoke-RestMethod 'http://127.0.0.1:5187/api/segmentation/refine/health' -TimeoutSec 2
        if ($taskHealth.preset -eq 'strong') { exit 0 }
    } catch {}
}
throw 'Local service failed to start; check service-error.log and port 5187.'
