$ErrorActionPreference = "Stop"
$Root = "C:\Users\mulya\Documents\XAUGBPEUUSD"
Set-Location $Root
Remove-Item Env:PATH -ErrorAction SilentlyContinue
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
$backend = Start-Process -FilePath ".\.venv\Scripts\python.exe" -ArgumentList @("-m", "uvicorn", "backend.app.main:app", "--host", "127.0.0.1", "--port", "9000") -WorkingDirectory $Root -RedirectStandardOutput "logs\live-backend.log" -RedirectStandardError "logs\live-backend.err.log" -WindowStyle Hidden -PassThru
$env:BACKEND_URL = "http://127.0.0.1:9000"
$env:FRONTEND_PORT = "5174"
$frontend = Start-Process -FilePath "node.exe" -ArgumentList @("scripts\serve-dist-proxy.cjs") -WorkingDirectory $Root -RedirectStandardOutput "logs\live-frontend.log" -RedirectStandardError "logs\live-frontend.err.log" -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 6
Write-Host "Backend PID $($backend.Id), Frontend PID $($frontend.Id)"
try {
    Invoke-RestMethod -Uri "http://127.0.0.1:9000/api/backend/health" -TimeoutSec 5 | ConvertTo-Json -Compress | Write-Host
} catch {
    Write-Host ("BACKEND_FAIL " + $_.Exception.Message)
}
try {
    Invoke-WebRequest -Uri "http://127.0.0.1:5174/" -UseBasicParsing -TimeoutSec 5 | Select-Object -ExpandProperty StatusCode | Write-Host
} catch {
    Write-Host ("FRONTEND_FAIL " + $_.Exception.Message)
}
try {
    Invoke-RestMethod -Uri "http://127.0.0.1:9000/api/ea/status" -TimeoutSec 5 | ConvertTo-Json -Compress | Write-Host
} catch {
    Write-Host ("EA_FAIL " + $_.Exception.Message)
}
Write-Host "LIVE_SERVER_HOLD: app stays online for 1 hour while this command is running."
Start-Sleep -Seconds 3600
