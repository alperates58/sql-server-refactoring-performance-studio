@echo off
setlocal
cd /d "%~dp0"
title SQL Server Refactoring ^& Performance Studio

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [HATA] Node.js bulunamadi. Node.js 20 veya uzeri kurulmalidir.
  echo https://nodejs.org/
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Ilk calistirma: gerekli Node paketleri kuruluyor...
  call npm install
  if errorlevel 1 (
    echo [HATA] npm install basarisiz.
    pause
    exit /b 1
  )
)

start "" http://localhost:3000
node server.js
pause
