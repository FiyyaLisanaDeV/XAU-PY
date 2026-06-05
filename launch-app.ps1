$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendPort = 9000
$FrontendPort = 5174
$FrontendUrl = "http://127.0.0.1:$FrontendPort/"
$LogsDir = Join-Path $Root "logs"

function Write-Step($Message) {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $Message"
}

function Test-Port($Port) {
    $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    return $null -ne $connection
}

function Wait-Http($Url, $Name) {
    for ($attempt = 1; $attempt -le 40; $attempt++) {
        try {
            Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2 | Out-Null
            Write-Step "$Name ready: $Url"
            return
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }
    throw "$Name did not become ready at $Url"
}

Set-Location $Root
New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null
Remove-Item Env:PATH -ErrorAction SilentlyContinue
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

Write-Step "XAUGBPEUUSD launcher"
Write-Step "Workspace: $Root"

if (-not (Test-Path (Join-Path $Root "node_modules"))) {
    Write-Step "node_modules not found. Running npm install..."
    npm install
}

if (Test-Path (Join-Path $Root ".venv\Scripts\python.exe")) {
    $PythonExe = Join-Path $Root ".venv\Scripts\python.exe"
} else {
    $PythonExe = "python"
}

if (-not (Test-Port $BackendPort)) {
    Write-Step "Starting FastAPI backend on port $BackendPort..."
    $backendLog = Join-Path $LogsDir "backend.log"
    $backendErr = Join-Path $LogsDir "backend.err.log"
    Start-Process -FilePath $PythonExe `
        -ArgumentList "-m", "uvicorn", "backend.app.main:app", "--host", "127.0.0.1", "--port", "$BackendPort" `
        -WorkingDirectory $Root `
        -RedirectStandardOutput $backendLog `
        -RedirectStandardError $backendErr `
        -WindowStyle Hidden
} else {
    Write-Step "Backend already listening on port $BackendPort."
}

if (-not (Test-Port $FrontendPort)) {
    Write-Step "Starting frontend static proxy on port $FrontendPort..."
    $frontendLog = Join-Path $LogsDir "frontend.log"
    $frontendErr = Join-Path $LogsDir "frontend.err.log"
    Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c", "node scripts\serve-dist-proxy.cjs" `
        -WorkingDirectory $Root `
        -RedirectStandardOutput $frontendLog `
        -RedirectStandardError $frontendErr `
        -WindowStyle Hidden
} else {
    Write-Step "Frontend already listening on port $FrontendPort."
}

Wait-Http "http://127.0.0.1:$BackendPort/api/status" "Backend"
Wait-Http $FrontendUrl "Frontend"

try {
    Invoke-RestMethod -Method Post `
        -Uri "http://127.0.0.1:$BackendPort/api/demo-guard" `
        -ContentType "application/json" `
        -Body '{"enabled":true}' | Out-Null
    $status = Invoke-RestMethod "http://127.0.0.1:$BackendPort/api/status"
    Write-Step "MT5: $($status.message)"
    Write-Step "Account: $($status.server) / Equity $($status.equity) $($status.currency)"
} catch {
    Write-Step "Backend is running, but MT5 status could not be read."
}

Write-Step "Opening app in default browser..."
Start-Process $FrontendUrl
Write-Step "Done. Logs are in: $LogsDir"
