@echo off
rem Dvoynoy klik: srazu udalenie, bez menyu.
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" -Action Uninstall
echo.
pause
