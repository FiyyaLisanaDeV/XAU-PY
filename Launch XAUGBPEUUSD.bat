@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch-app.ps1"
echo.
echo Press any key to close this launcher window.
pause >nul
