@echo off
rem Double-click to get the latest code from GitHub and run the game locally (http://localhost:3000).
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 18+ is required: https://nodejs.org & pause & exit /b 1)
echo Updating from GitHub...
git pull --ff-only || echo (could not update: continuing with the code you have)
call npm install --no-audit --no-fund || (pause & exit /b 1)
start "" http://localhost:3000
call npm start
pause
