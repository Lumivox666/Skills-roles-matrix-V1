@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo Node.js 20+ is required. Install at https://nodejs.org
 pause
 exit /b 1
)
if not defined APP_PASSWORD (
 echo TCG Skills and Roles - local test
 echo Create a shared access password for this session ^(12+ characters recommended^).
 set /p APP_PASSWORD=App password: 
)
if not defined APP_PASSWORD (
 echo Password empty. For local loopback-only testing run node server.js manually.
 pause
 exit /b 1
)
node server.js
pause
