@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo 请先安装 Node.js 22 或更新版本，再运行本文件。
 pause
 exit /b 1
)
echo 空间工坊 · 电脑与手机同时使用
echo 服务将在后台运行，已有服务会直接复用。
node start-local-services.mjs --editor-only
if errorlevel 1 (
 pause
 exit /b 1
)
if /I "%~1"=="--phone" (
 start "" "http://127.0.0.1:8787/phone"
) else (
 start "" "http://127.0.0.1:8787/"
)
