@echo off
chcp 65001 >nul
cd /d "%~dp0"
py -3 downloader.py
if errorlevel 1 echo Failed. Check Python 3 installation or whether port 18765 is in use.
pause
