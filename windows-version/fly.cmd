@echo off
REM Double-click to list flights, or run a trip:  fly.cmd nyc
REM Choreographs an airplane-mode "flight" so Life360 pushes "arrived at <destination>".
REM Read tools\fly.py header first; verify the airplane-mode tunnel gate (Step 0) once.
setlocal
set "PY=%~dp0..\.venv\Scripts\python.exe"
if not exist "%PY%" goto noenv
"%PY%" "%~dp0..\core\tools\fly.py" %*
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
