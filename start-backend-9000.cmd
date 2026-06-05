@echo off
cd /d "C:\Users\mulya\Documents\XAUGBPEUUSD"
".venv\Scripts\python.exe" -m uvicorn backend.app.main:app --host 127.0.0.1 --port 9000
