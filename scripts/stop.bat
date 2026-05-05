@echo off
echo Остановка бота...
taskkill /F /IM node.exe 2>nul
echo Бот остановлен!
timeout /t 2
