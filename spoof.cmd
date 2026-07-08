@echo off
REM Double-click to open the preset menu, or run:  spoof.cmd eiffel  /  spoof.cmd 48.8584 2.2945  /  spoof.cmd clear
"%~dp0.venv\Scripts\python.exe" "%~dp0spoof.py" %*
pause
