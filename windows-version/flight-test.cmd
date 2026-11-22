@echo off
REM Double-click to run the Life360 Flight Detection test (MIA -> MCO):
REM   windows-version\flight-test.cmd
REM Or fallback geofence arrival:
REM   windows-version\flight-test.cmd geofence
REM Clear:
REM   windows-version\flight-test.cmd --clear

setlocal
set "PY=%~dp0..\.venv\Scripts\python.exe"
if not exist "%PY%" goto noenv
"%PY%" "%~dp0..\core\tools\flight_test.py" %*
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
