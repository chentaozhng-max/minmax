@echo off
setlocal
cd /d "%~dp0"
title PsyMatch

if not exist "node_modules\" (
  echo [1/3] Installing dependencies. First run may take several minutes...
  call npm install --registry=https://registry.npmmirror.com
  if errorlevel 1 goto fail
)

if not exist "prisma\dev.db" (
  echo [2/3] Preparing database and demo data...
  call npm run setup
  if errorlevel 1 goto fail
)

if not exist ".next\BUILD_ID" (
  echo [3/3] Building. About one minute on first run...
  call npm run build
  if errorlevel 1 goto fail
)

echo.
echo Starting PsyMatch at http://localhost:3000
echo Keep the server window open while using it.
echo.

start "PsyMatch Server" cmd /k node scripts\next-run.mjs start -p 3000
ping -n 6 127.0.0.1 >nul
start "" http://localhost:3000
exit /b 0

:fail
echo.
echo Startup failed. Check the messages above.
pause
exit /b 1
