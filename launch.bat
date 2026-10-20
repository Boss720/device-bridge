@echo off
title DeviceBridge Launcher
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================================
echo               Launching DeviceBridge...
echo ========================================================
echo.

:: Check if node is installed
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not found in your PATH.
    echo Please install Node.js from https://nodejs.org/ to run DeviceBridge.
    echo.
    pause
    exit /b 1
)

:: Check if dependencies are installed
if not exist "node_modules\" (
    echo [INFO] First time setup: Installing dependencies...
    call npm install
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Failed to install dependencies.
        pause
        exit /b 1
    )
    echo [INFO] Dependencies installed successfully.
    echo.
)

:: Launch the application
echo [INFO] Starting DeviceBridge Desktop App...
start "" npm start

exit /b 0
