@echo off
cd /d "%~dp0"
title AI Evolution Polska - 360 Studio
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Start-Studio.ps1"
if errorlevel 1 pause
