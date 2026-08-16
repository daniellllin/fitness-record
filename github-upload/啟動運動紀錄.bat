@echo off
setlocal
cd /d "%~dp0"
title Fitness Record - local server

echo ============================================
echo   Daily Fitness Record  /  local server
echo   URL: http://localhost:8080
echo   Press Ctrl+C or close this window to stop
echo ============================================
echo.

where python >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:8080
  python -m http.server 8080
  goto :eof
)

where py >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:8080
  py -m http.server 8080
  goto :eof
)

where node >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:8080
  node server.js
  goto :eof
)

echo Python / Node.js not found - falling back to Windows PowerShell.
start "" http://localhost:8080
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
