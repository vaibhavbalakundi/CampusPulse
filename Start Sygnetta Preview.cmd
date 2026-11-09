@echo off
setlocal
cd /d "%~dp0"
set "SYGNETTA_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%SYGNETTA_NODE%" goto start
where node >nul 2>nul
if errorlevel 1 goto missing
set "SYGNETTA_NODE=node"
:start
echo CampusPulse sign-in by Sygnetta: http://127.0.0.1:3000/software/
echo Keep this window open while viewing the preview. Press Ctrl+C to stop.
echo.
"%SYGNETTA_NODE%" scripts\software-preview.mjs
echo.
echo The preview server has stopped.
pause
exit /b
:missing
echo Node.js was not found. Install Node.js or open this project in Codex so its bundled runtime is available.
pause
exit /b 1
