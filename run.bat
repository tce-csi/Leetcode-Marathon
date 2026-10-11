@echo off
REM ===============================================================
REM   CodeQuest - One-Click Launcher for Windows
REM ===============================================================

title CodeQuest Contest Platform

where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not found in your PATH.
    echo Please install Node.js 20+ from https://nodejs.org
    pause
    exit /b 1
)

node "%~dp0run.js"
