@echo off
rem Obolochka dlya dvoynogo klika: zapuskaet setup.ps1 v obhod ExecutionPolicy,
rem ne menyaya nastroyki samoy sistemy.
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
echo.
pause
