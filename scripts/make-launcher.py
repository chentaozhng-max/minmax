# -*- coding: utf-8 -*-
"""
生成 `启动 PsyMatch.cmd`。编码这块踩过两次，都记在这儿：

1. 文件存 **GBK + CRLF**。存 UTF-8 会出两种问题：
   - 加 BOM：第一行变成 `?@echo off`，直接报「不是内部或外部命令」。
   - 不加 BOM + `chcp 65001`：cmd 按字节读批处理有已知 bug，含中文的长注释行会被
     错位截断，后半截当成命令执行（实测报 `'被清掉，' 不是内部或外部命令`）。
2. 但 node 子进程输出的是 UTF-8，在 936 代码页下显示成 `鏋勫缓浜х墿` 这种乱码，
   看着像报错。所以**只在调用 node 的那几行**临时 `chcp 65001`，回来再切 936：
   这段期间执行的只有纯 ASCII 命令行，不会触发上面那个错位 bug。
"""
import pathlib

BAT = r"""@echo off
chcp 936 >nul 2>&1
setlocal enabledelayedexpansion
cd /d "%~dp0"
title PsyMatch 启动器

echo ============================================================
echo   PsyMatch   心理学实验的报名与排期
echo ============================================================
echo.

rem ============================================================
rem  1. 找 Node.js
rem     有些机器的 PATH 里 nodejs 那条是坏的（少了盘符），
rem     双击时 where 就找不到，所以这里自己再找一遍。
rem ============================================================
set "NODE="
for /f "delims=" %%i in ('where node.exe 2^>nul') do (
  if not defined NODE set "NODE=%%i"
)
if not defined NODE if exist "C:\Program Files\nodejs\node.exe" set "NODE=C:\Program Files\nodejs\node.exe"
if not defined NODE (
  for /d %%d in ("%USERPROFILE%\.workbuddy\binaries\node\versions\*") do (
    if exist "%%d\node.exe" set "NODE=%%d\node.exe"
  )
)
if not defined NODE (
  echo [错误] 这台电脑上没找到 Node.js。
  echo.
  echo 请打开 https://nodejs.org 下载 LTS 版本，装完再双击本文件。
  echo.
  pause
  exit /b 1
)
for %%i in ("%NODE%") do set "NODE_DIR=%%~dpi"
set "NPM=%NODE_DIR%npm.cmd"
echo [1/6] Node.js:  %NODE%

rem ============================================================
rem  2. 端口 3000
rem     上次的服务器窗口还没关的话，这里直接结束它。
rem     以前是让用户按 Y/N，很多人到这一步就卡住不动了。
rem ============================================================
set "OLD_PID="
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /r /c:":3000 " ^| findstr "LISTENING"') do (
  if not defined OLD_PID set "OLD_PID=%%a"
)
if defined OLD_PID (
  echo [2/6] 端口 3000 被占用 ^(PID !OLD_PID!^)，应该是上次没关的 PsyMatch
  taskkill /F /PID !OLD_PID! >nul 2>&1
  if errorlevel 1 (
    echo       结束失败。请手动关掉占用 3000 端口的程序后重试。
    echo.
    pause
    exit /b 1
  )
  echo       已结束旧进程，继续。
  timeout /t 2 /nobreak >nul
) else (
  echo [2/6] 端口 3000 空闲
)

rem ============================================================
rem  3. 依赖
rem ============================================================
if not exist "node_modules\" (
  echo [3/6] 第一次运行，正在安装依赖。可能要好几分钟，请不要关窗口...
  call "%NPM%" install --registry=https://registry.npmmirror.com
  if errorlevel 1 goto fail
) else (
  echo [3/6] 依赖已就绪
)

rem ============================================================
rem  4. 数据库
rem ============================================================
if not exist "prisma\dev.db" (
  echo [4/6] 正在建库并写入演示数据...
  chcp 65001 >nul 2>&1
  call "%NPM%" run setup
  set "SETUP_RC=!errorlevel!"
  chcp 936 >nul 2>&1
  if not "!SETUP_RC!"=="0" goto fail
) else (
  echo [4/6] 数据库已就绪
)

rem ============================================================
rem  5. Prisma Client 与构建产物
rem     构建被中断过的话 node_modules\.prisma\client 会被清掉，
rem     少了它每个页面都返回 500，所以单独查一次。
rem ============================================================
if not exist "node_modules\.prisma\client\index.js" (
  echo [5/6] 修补 Prisma Client...
  chcp 65001 >nul 2>&1
  call "%NODE%" "node_modules\prisma\build\index.js" generate
  set "PRISMA_RC=!errorlevel!"
  chcp 936 >nul 2>&1
  if not "!PRISMA_RC!"=="0" goto fail
)
echo [5/6] 检查构建产物。源码有改动会自动重建，可能要 1 到 3 分钟，请不要关窗口...
chcp 65001 >nul 2>&1
"%NODE%" scripts\build-if-needed.mjs
set "BUILD_RC=!errorlevel!"
chcp 936 >nul 2>&1
if not "!BUILD_RC!"=="0" goto fail

rem ============================================================
rem  6. 启动
rem     浏览器由 open-when-ready 在端口真正响应之后才打开，
rem     以前固定等 5 秒就开，服务还没起来，看着像启动失败。
rem ============================================================
echo [6/6] 启动服务...
echo.
echo ------------------------------------------------------------
echo   电脑访问   http://localhost:3000
echo.
echo   手机访问   另开一个窗口运行 ipconfig，找到本机 192.168.x.x
echo              或 172.x.x.x 的地址；手机连同一个 Wi-Fi 后
echo              浏览器打开 http://那个地址:3000
echo.
echo   这个窗口就是服务器，关掉它服务就停了。
echo ------------------------------------------------------------
echo.

rem 下面这两行让服务在 65001 下拉起，next / scheduler 的中文日志才不乱码。
chcp 65001 >nul 2>&1
start "" /b "%NODE%" scripts\open-when-ready.mjs http://localhost:3000 >nul 2>&1
"%NODE%" scripts\next-run.mjs start -p 3000
set "RUN_RC=!errorlevel!"
chcp 936 >nul 2>&1
if not "!RUN_RC!"=="0" goto fail

echo.
echo 服务已停止，关掉这个窗口即可，下次再双击启动。
pause
exit /b 0

:fail
echo.
echo ------------------------------------------------------------
echo   启动失败。请把上面的报错内容发给开发者。
echo ------------------------------------------------------------
echo.
pause
exit /b 1
"""

ROOT = pathlib.Path(__file__).resolve().parent.parent
p = ROOT / "启动 PsyMatch.cmd"

# GBK（不带 BOM）+ 显式 CRLF
with p.open("w", encoding="gbk", newline="\r\n") as f:
    f.write(BAT)

data = p.read_bytes()
print("写入完成:", p)
print("字节数:", len(data))
print("有无 BOM:", data[:3] == b"\xef\xbb\xbf")
print("行尾 CRLF:", data.count(b"\r\n"), "个")
print("行尾裸 LF:", data.count(b"\n") - data.count(b"\r\n"), "个")
print("中文行数:", sum(1 for ln in data.split(b"\r\n") if any(b > 127 for b in ln)))
print("GBK 全部可解码:", data.decode("gbk", errors="replace").count("\ufffd") == 0)
