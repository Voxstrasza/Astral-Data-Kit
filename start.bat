@echo off
REM Launches Astral and opens it in your default browser.
cd /d "%~dp0"
node server.js --open
pause
