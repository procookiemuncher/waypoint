@echo off
REM Drive a route with a REAL speed (Life360 shows mph + the car icon). No Xcode needed.
REM   drive.cmd emoji-test  /  drive.cmd miami-cruise --mph 25  /  drive.cmd --clear
setlocal
set "PY=%~dp0..\.venv\Scripts\python.exe"
if not exist "%PY%" goto noenv
"%PY%" "%~dp0..\core\tools\drive.py" %*
pause
exit /b 0

:noenv
echo.
echo Could not find the virtual environment at .venv
echo Set it up first (see windows-version\README.md):
echo     windows-version\setup.cmd
echo.
pause
exit /b 1
