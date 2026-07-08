@echo off
REM Double-click for the "where do you want to go?" menu, or run:
REM   spoof.cmd miami  /  spoof.cmd eiffel  /  spoof.cmd 48.8584 2.2945  /  spoof.cmd clear
setlocal
set "PY=%~dp0.venv\Scripts\python.exe"
if not exist "%PY%" goto noenv
"%PY%" "%~dp0spoof.py" %*
pause
exit /b 0

:noenv
echo.
echo Could not find the virtual environment at .venv
echo Set it up first (see docs\BUILD_PLAN.md, section "Environment"):
echo     uv venv --python 3.12
echo     uv pip install -r requirements.txt
echo.
pause
exit /b 1
