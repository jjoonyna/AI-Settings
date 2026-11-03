@echo off
setlocal
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
set "install_result=%errorlevel%"
echo.
if not "%install_result%"=="0" echo Installation failed. See the error and log path above.
echo Press any key to close this window.
pause >nul
exit /b %install_result%
