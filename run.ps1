# CodeQuest - PowerShell Launcher
$ErrorActionPreference = "Stop"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Node.js is not found in your PATH." -ForegroundColor Red
    Write-Host "Please install Node.js 20+ from https://nodejs.org"
    Exit 1
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
node "$ScriptDir\run.js"
