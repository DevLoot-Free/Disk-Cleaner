@echo off
title DiskCleaner
echo.
echo  ========================================
echo   DiskCleaner wird gestartet...
echo  ========================================
echo.

:: Check if Node.js is installed
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [FEHLER] Node.js ist nicht installiert!
    echo.
    echo  Bitte installiere Node.js von: https://nodejs.org
    echo  Dann diese Datei nochmal ausfuehren.
    echo.
    pause
    exit /b 1
)

:: Get script directory
cd /d "%~dp0"

:: Start server and open browser
echo  Server laeuft auf http://localhost:3333
echo  Browser wird geoeffnet...
echo.
echo  Zum Beenden: Dieses Fenster schliessen
echo.

:: Open browser after short delay
start "" /b cmd /c "timeout /t 2 >nul && start http://localhost:3333"

:: Run node server
node server.js

pause
