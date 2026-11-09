@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules\esbuild\package.json" (
  echo Run npm install in this folder first.
  pause
  exit /b 1
)
node server.mjs %*
if errorlevel 1 pause
