@echo off
rem Rally 3D native port - one-click launcher (Windows)
cd /d "%~dp0"
start "" /min cmd /c "timeout /t 2 /nobreak >nul & start "" http://localhost:8088/game/index.html"
where py >nul 2>nul
if %errorlevel%==0 (
  py serve.py 8088
) else (
  python serve.py 8088
)
