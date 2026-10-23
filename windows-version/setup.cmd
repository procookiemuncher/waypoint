@echo off
REM One-time setup on Windows: creates .venv (Python 3.12) and installs pymobiledevice3.
REM Needs uv (https://docs.astral.sh/uv/) and the Apple Devices app (or iTunes) for the USB driver.
setlocal
cd /d "%~dp0.."
where uv >nul 2>nul
if errorlevel 1 goto nouv
uv venv --python 3.12 || goto fail
uv pip install -r requirements.txt || goto fail
echo.
echo Done. Plug in the iPhone, unlock it, then try:  windows-version\spoof.cmd
pause
exit /b 0

:nouv
echo uv isn't installed. In PowerShell run:
echo     powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
pause
exit /b 1

:fail
echo.
echo Setup failed - see the error above.
pause
exit /b 1
