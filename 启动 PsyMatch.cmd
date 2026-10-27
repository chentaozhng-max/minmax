@echo off
setlocal
cd /d "%~dp0"
title PsyMatch

rem ---------------------------------------------------------------
rem 有些机器的系统 PATH 里 nodejs 那条是坏的（少了盘符），
rem 双击时 node 就找不到。这里自己找一遍，找不到再报错。
rem ---------------------------------------------------------------
set "NODE=node"
set "NPM=npm"
where node >nul 2>&1
if errorlevel 1 (
  if exist "C:\Program Files\nodejs\node.exe" (
    set "NODE=C:\Program Files\nodejs\node.exe"
    set "NPM=C:\Program Files\nodejs\npm.cmd"
  ) else (
    echo Node.js was not found on this PC.
    echo Install the LTS version from https://nodejs.org/ and run this again.
    pause
    exit /b 1
  )
)

rem ---------------------------------------------------------------
rem 3000 被占用，通常是上一次的 PsyMatch Server 窗口还在跑。
rem 问一句，按 Y 就结束它继续。
rem ---------------------------------------------------------------
set OLD_PID=
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do set OLD_PID=%%a
if not "%OLD_PID%"=="" (
  echo Port 3000 is busy ^(PID %OLD_PID%^) - looks like the old PsyMatch server.
  choice /C YN /N /M "Kill it and continue? [Y/N] "
  if errorlevel 2 (
    echo Close that window yourself, then run this again.
    pause
    exit /b 1
  )
  taskkill /F /PID %OLD_PID% >nul 2>&1
  timeout /t 2 /nobreak >nul
)

if not exist "node_modules\" (
  echo [1/3] Installing dependencies. First run may take several minutes...
  call "%NPM%" install --registry=https://registry.npmmirror.com
  if errorlevel 1 goto fail
)

if not exist "prisma\dev.db" (
  echo [2/3] Preparing database and demo data...
  call "%NPM%" run setup
  if errorlevel 1 goto fail
)

rem ---------------------------------------------------------------
rem 源码比构建新、或产物不全，就重新构建。
rem ---------------------------------------------------------------
echo [3/3] Checking build (rebuilds when source is newer)...
"%NODE%" scripts\build-if-needed.mjs
if errorlevel 1 goto fail

echo.
echo Starting PsyMatch at http://localhost:3000
echo.
echo Phone access: run "ipconfig" in another window, find this PC's
echo 192.168.x / 172.x address, then open http://THAT-IP:3000
echo (phone must be on the same Wi-Fi / router).
echo.
echo Keep the server window open while using it.
echo.

start "PsyMatch Server" cmd /k "%NODE%" scripts\next-run.mjs start -p 3000
ping -n 6 127.0.0.1 >nul
start "" http://localhost:3000
exit /b 0

:fail
echo.
echo Startup failed. Check the messages above.
pause
exit /b 1
