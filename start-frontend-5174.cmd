@echo off
cd /d "C:\Users\mulya\Documents\XAUGBPEUUSD"
set BACKEND_URL=http://127.0.0.1:9000
set FRONTEND_PORT=5174
node scripts\serve-dist-proxy.cjs
