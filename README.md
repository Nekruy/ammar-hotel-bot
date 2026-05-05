# 🏨 AMMAR Hotel AI Bot — Полная документация

AI Бот-консьерж для AMMAR Grand Hotel, Душанбе  
**AI: Claude claude-sonnet-4-6 (Anthropic) | Node.js + TypeScript**

---

## Структура проекта

```
ammar-bot/
├── src/
│   ├── server/
│   │   └── index.ts              ← Точка входа, Express сервер
│   ├── ai/
│   │   └── claudeService.ts      ← Claude API, агентный цикл
│   ├── bot/
│   │   ├── telegramHandler.ts    ← Telegram бот для гостей
│   │   └── whatsappHandler.ts    ← WhatsApp бот
│   ├── tools/
│   │   └── executor.ts           ← 12 инструментов
│   ├── integrations/
│   │   ├── staffNotifier.ts      ← Уведомления персонала
│   │   └── checkinn.ts           ← CheckInn PMS (заглушка)
│   ├── config/
│   │   ├── systemPrompt.ts       ← Промпт бота (мозг)
│   │   └── tools.ts              ← Определения инструментов
│   └── utils/
│       ├── logger.ts             ← Winston логирование
│       ├── db.ts                 ← Prisma клиент
│       └── redis.ts              ← Сессии и история
├── prisma/
│   └── schema.prisma             ← Схема БД
├── docker/
│   ├── Dockerfile
│   └── docker-compose.prod.yml
├── nginx/
│   └── nginx.conf
├── scripts/
│   └── deploy.sh                 ← Деплой на VPS одной командой
├── .env.example
├── package.json
└── tsconfig.json
```

---

## 12 функций бота

| # | Инструмент | Что делает |
|---|-----------|------------|
| 1 | `get_booking` | Статус брони из CheckInn |
| 2 | `create_room_service` | Заказ еды → уведомление кухне |
| 3 | `create_housekeeping` | Уборка/полотенца → горничным |
| 4 | `arrange_taxi` | Такси/аэропорт → ресепшн |
| 5 | `get_city_info` | Гид по Душанбе |
| 6 | `get_exchange_rate` | Курс USD/RUB/EUR/CNY |
| 7 | `escalate_to_staff` | Жалобы → персонал срочно |
| 8 | `create_upsell` | Апгрейд, SPA, поздний выезд |
| 9 | `get_restaurant_menu` | Меню ресторана AMMAR |
| 10 | `request_wake_up` | Звонок-побудка |
| 11 | `arrange_excursion` | Экскурсии по Таджикистану |
| 12 | `get_weather` | Погода в Душанбе |

---

## ШАГИ ЗАПУСКА

### ШАГ 1 — Создать Telegram боты

**БОТ 1 (для гостей):**
```
Telegram → @BotFather → /newbot
Имя: AMMAR Hotel Concierge
Username: AMMARHotelBot
→ Сохранить токен → TELEGRAM_BOT_TOKEN
```

**БОТ 2 (для персонала):**
```
Telegram → @BotFather → /newbot
Имя: AMMAR Staff Bot
Username: AMMARStaffBot
→ Сохранить токен → STAFF_BOT_TOKEN
```

**Чаты персонала (создать 4 группы в Telegram):**
```
"Кухня AMMAR"         → добавить AMMARStaffBot → ID → STAFF_CHAT_KITCHEN
"Горничные AMMAR"     → добавить AMMARStaffBot → ID → STAFF_CHAT_HOUSEKEEPING
"Ресепшн AMMAR"       → добавить AMMARStaffBot → ID → STAFF_CHAT_RECEPTION
"GM AMMAR"            → добавить AMMARStaffBot → ID → STAFF_CHAT_GM
```

*Узнать ID чата: добавить @userinfobot в чат → написать любое сообщение*

### ШАГ 2 — Получить ключ Claude API

```
1. Зайти на console.anthropic.com
2. API Keys → Create Key
3. Скопировать → ANTHROPIC_API_KEY
```

### ШАГ 3 — Установка (локально для разработки)

```bash
# Установить Node.js 20
# https://nodejs.org → LTS

# Клонировать/скопировать проект
cd ammar-bot

# Установить зависимости
npm install

# Создать .env
cp .env.example .env
# Заполнить своими ключами

# Запустить базу данных (для разработки без PostgreSQL)
# Бот работает и без БД — просто без истории в PostgreSQL

# ЗАПУСК
npm run dev
```

**При успешном запуске увидите:**
```
2026-04-20 10:30:00 [info] 🚀 Server started {"port":3000}
2026-04-20 10:30:01 [info] ✅ Telegram bot: @AMMARHotelBot
2026-04-20 10:30:01 [info] 🏨 AMMAR Hotel AI Bot is ready!
```

### ШАГ 4 — Тестирование

```
Telegram → @AMMARHotelBot → /start
→ Написать: 412
→ Написать: Чой оварда дода мешавад?  ← тест таджикского
→ Написать: Полотенца пожалуйста      ← тест хаускипинга
→ Написать: What time is checkout?    ← тест английского
```

### ШАГ 5 — Деплой на Railway (рекомендуется)

Railway — самый простой способ запустить бота без настройки серверов.

**5.1 Подготовить репозиторий:**
```bash
git init
git add .
git commit -m "Initial commit"
# Создать репозиторий на GitHub и запушить
git remote add origin https://github.com/ВАШ-АККАУНТ/ammar-bot.git
git push -u origin main
```

**5.2 Создать проект на Railway:**
```
1. Зайти на railway.app → New Project
2. Deploy from GitHub repo → выбрать ammar-bot
3. Railway автоматически запустит: npm install && npm run build && npm start
```

**5.3 Добавить переменные окружения (Variables):**
```
ANTHROPIC_API_KEY=sk-ant-...
TELEGRAM_BOT_TOKEN=...
STAFF_BOT_TOKEN=...
STAFF_CHAT_KITCHEN=-100...
STAFF_CHAT_HOUSEKEEPING=-100...
STAFF_CHAT_RECEPTION=-100...
STAFF_CHAT_GM=-100...
REDIS_URL=redis://...        ← добавить Redis сервис в Railway
NODE_ENV=production
PORT=3000
```

**5.4 Добавить Redis:**
```
Railway → New Service → Database → Redis
→ Скопировать REDIS_URL → вставить в Variables
```

**5.5 Проверить:**
```
Railway → Deployments → View Logs
→ Должно появиться: 🚀 Server started {"port":3000}
→ Settings → Domain → сгенерировать URL
→ curl https://ВАШ-ДОМЕН.railway.app/health
```

---

### ШАГ 5б — Деплой на VPS

```bash
# Арендовать VPS:
# Hetzner.com → CX11 → €4/мес → Ubuntu 22.04

# Подключиться:
ssh root@ВАШ-IP

# Скопировать проект:
scp -r ./ammar-bot/* root@ВАШ-IP:/var/www/ammar-bot/

# Создать .env на сервере:
nano /var/www/ammar-bot/.env

# Запустить установку:
cd /var/www/ammar-bot
chmod +x scripts/deploy.sh
bash scripts/deploy.sh

# Проверить:
pm2 status
curl http://localhost:3000/health
```

### ШАГ 6 — Подключить CheckInn (позже)

```env
# В .env изменить:
CHECKINN_ENABLED=true
CHECKINN_API_URL=https://api.checkinn.tj/v1
CHECKINN_API_KEY=ваш-ключ-от-checkinn
```

---

## Каналы и боты

| Канал | Описание |
|-------|---------|
| @AMMARHotelBot | Telegram для гостей |
| WhatsApp номер | WhatsApp для гостей |
| /api/chat | Web Chat на сайте |
| @AMMARStaffBot | Уведомления персонала |

---

## Стоимость в месяц

| Сервис | Railway | VPS (Hetzner) |
|--------|---------|---------------|
| Хостинг | $5-20/мес | €4/мес |
| Redis | $5/мес | бесплатно (локально) |
| Grok API (xAI) | ~$10-30 | ~$10-30 |
| Telegram боты | Бесплатно | Бесплатно |
| **Итого** | **~$20-55/мес** | **~$15-35/мес** |

---

## Разработано

**LOTUS IT Solutions — Официальный партнёр CheckInn**  
📞 +992 207 200 007  
✉️ nekruyr@gmail.com  
💬 @lotus_tj
