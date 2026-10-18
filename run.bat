@echo off
rem TRACEFUSE for Windows - double-click this file, or run:  run.bat   run.bat --port 9000   run.bat --offline
setlocal
cd /d "%~dp0"
set "PORT=8000"

:args
if "%~1"=="" goto :start
if /i "%~1"=="--port" (set "PORT=%~2" & shift & shift & goto :args)
if /i "%~1"=="--offline" (set "TRACEFUSE_OFFLINE=1" & shift & goto :args)
echo Unknown option: %~1   (use --port N or --offline)
goto :fail

:start
rem ---- Python: create backend\.venv on first run ----
if exist "backend\.venv\Scripts\uvicorn.exe" goto :ui
set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY (where python >nul 2>nul && set "PY=python")
if not defined PY (echo Python was not found. Install Python 3.11+ from python.org and tick "Add Python to PATH". & goto :fail)
echo Setting up Python (first run only, takes a few minutes)...
%PY% -m venv backend\.venv || goto :fail
backend\.venv\Scripts\python -m pip install --quiet --upgrade pip
backend\.venv\Scripts\python -m pip install --quiet -e backend || goto :fail

:ui
rem ---- Web UI: install and build on first run ----
if exist "frontend\dist\index.html" goto :serve
where npm >nul 2>nul || (echo Node.js was not found. Install Node.js 20+ LTS from nodejs.org. & goto :fail)
echo Building the web interface (first run only, takes a few minutes)...
pushd frontend
call npm ci --no-audit --no-fund || (popd & goto :fail)
call npm run build || (popd & goto :fail)
popd

:serve
echo.
echo   TRACEFUSE is starting. Open http://127.0.0.1:%PORT% in your browser.
echo   Press Ctrl+C in this window to stop.
echo.
cd backend
.venv\Scripts\uvicorn tracefuse.api.app:app --host 127.0.0.1 --port %PORT%
goto :eof

:fail
echo.
echo Setup did not finish. Read the message above, fix it, then run run.bat again.
pause
exit /b 1
