@echo off
title AMMAR Hotel Bot
color 0A
echo.
echo  ╔══════════════════════════════════════╗
echo  ║      AMMAR Hotel Bot — Запуск       ║
echo  ╚══════════════════════════════════════╝
echo.

cd C:\Ammar_bot\ammar-bot-full

echo [1/3] Проверка зависимостей...
call npm install --silent

echo [2/3] Проверка .env...
if not exist .env (
    echo ОШИБКА: файл .env не найден!
    pause
    exit
)

echo [3/3] Запуск бота...
echo.
echo  Бот запущен! Не закрывайте это окно.
echo  Telegram: @AMMARHotelBot
echo  Веб чат:  http://localhost:3000
echo  Админка:  http://localhost:3000/admin
echo  Пароль:   ammar2026
echo.

:restart
node_modules\.bin\tsx.cmd src/server/index.ts
echo Бот упал — перезапуск через 5 секунд...
timeout /t 5
goto restart
