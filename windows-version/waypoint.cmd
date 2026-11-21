@echo off
REM Double-click to open Waypoint (the map app). No console; the log is in %LOCALAPPDATA%\Waypoint\Waypoint.log
REM UI work without touching the phone:  set VIDA_DRY_RUN=1 ^& windows-version\waypoint.cmd
setlocal
set "PYW=%~dp0..\.venv\Scripts\pythonw.exe"
if not exist "%PYW%" goto noenv
start "" "%PYW%" "%~dp0app.py"
exit /b 0

:noenv
echo.
echo Could not find the virtual environment at .venv
echo Set it up first (see windows-version\README.md):
echo     windows-version\setup.cmd
echo.
pause
exit /b 1
