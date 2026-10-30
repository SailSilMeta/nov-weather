@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动华南气象局域网服务...
echo 手机请连接与电脑相同的 Wi-Fi
node scripts/serve.js
echo.
pause
