# AMMAR Hotel Bot — Технический отчёт

> Дата: 2026-04-27 | Проект: ammar-hotel-bot v1.0.0  
> Автор анализа: Claude Sonnet 4.6

---

## 1. Архитектура приложения

### Структура модулей

```
src/
├── server/index.ts           # Точка входа — Express + инициализация ботов
├── bot/
│   ├── telegramHandler.ts    # Telegram-бот гостей (@AMMARHotelBot, grammy)
│   └── whatsappHandler.ts    # WhatsApp-бот (отключён, ENABLE_WHATSAPP=false)
├── ai/
│   └── grokService.ts        # AI-движок: агентный цикл Groq → tools → ответ
├── config/
│   ├── systemPrompt.ts       # Системный промпт: 4 языка, факты отеля, примеры
│   └── tools.ts              # 12 инструментов в формате OpenAI function calling
├── tools/
│   └── executor.ts           # Исполнитель инструментов → notifyStaff / checkinn
├── integrations/
│   ├── staffNotifier.ts      # Уведомления персонала через @AMMARStaffBot
│   └── checkinn.ts           # CheckInn PMS API (заглушка, готова к подключению)
└── utils/
    ├── redis.ts              # In-memory сессии и история (совместима с Redis)
    ├── db.ts                 # Prisma-заглушка (совместима с PostgreSQL)
    └── logger.ts             # Winston-логгер с цветовым выводом
```

### Схема потока данных

```
Гость (Telegram/WhatsApp/Web)
        │
        ▼
telegramHandler / whatsappHandler / POST /api/chat
        │
        ▼
  grokService.chat()
  ┌─────────────────────────────────────────┐
  │  while (iterations < 4):               │
  │    Groq API (llama-3.3-70b-versatile)  │
  │         │                              │
  │    finish_reason == "tool_calls"?      │
  │         │ yes                          │
  │    executeToolCall(name, input, guest) │
  │         │                              │
  │    ACTION tool? ──yes──► final reply  │
  │         │ no                           │
  │    continue loop                       │
  │                                        │
  │    finish_reason == "stop" ──► reply   │
  └─────────────────────────────────────────┘
        │
        ▼
  executor.ts → notifyStaff() → @AMMARStaffBot → Telegram группы
              → checkinn.getBooking() (mock или PMS)
              → safePrisma() (заглушка)
```

### Каналы уведомлений персонала

| Env-переменная           | Группа           | Чат ID          |
|--------------------------|------------------|-----------------|
| STAFF_CHAT_KITCHEN       | Кухня AMMAR      | -1003832574443  |
| STAFF_CHAT_HOUSEKEEPING  | Горничные AMMAR  | -1003917582986  |
| STAFF_CHAT_RECEPTION     | Ресепшн AMMAR    | -1003682793731  |
| STAFF_CHAT_GM            | GM AMMAR         | -1003988431750  |

---

## 2. Стек технологий

| Слой              | Технология                        | Версия   |
|-------------------|-----------------------------------|----------|
| Runtime           | Node.js                           | v24      |
| Язык              | TypeScript (strict: false)        | 5.6      |
| Dev-runner        | tsx (hot reload)                  | 4.19     |
| AI                | Groq API / llama-3.3-70b          | —        |
| AI SDK            | openai (OpenAI-compatible)        | 4.67     |
| Telegram (гости)  | grammy                            | 1.30     |
| Telegram (персонал)| axios → Bot API напрямую         | 1.7      |
| WhatsApp          | whatsapp-web.js + Puppeteer       | 1.23     |
| HTTP-сервер       | Express + helmet + cors           | 4.21     |
| Rate limiting     | express-rate-limit (100/min)      | 7.4      |
| Логирование       | Winston                           | 3.15     |
| Сессии            | In-memory Map (ioredis готов)     | —        |
| База данных        | Prisma-заглушка (PostgreSQL готов)| —        |
| Билд              | tsc → dist/                       | —        |

### Ключевые env-переменные

```env
GROQ_API_KEY=gsk_...                    # Groq API ключ
GROQ_MODEL=llama-3.3-70b-versatile      # Модель
TELEGRAM_BOT_TOKEN=...                  # @AMMARHotelBot (гости)
STAFF_BOT_TOKEN=...                     # @AMMARStaffBot (персонал)
STAFF_CHAT_KITCHEN / HOUSEKEEPING / RECEPTION / GM   # ID групп
ENABLE_WHATSAPP=false                   # Включить WhatsApp
DATABASE_URL=postgresql://...           # PostgreSQL (не активна)
REDIS_URL=redis://...                   # Redis (не активен)
CHECKINN_ENABLED=false                  # CheckInn PMS
CHECKINN_API_URL / CHECKINN_API_KEY     # (не заданы в .env)
```

---

## 3. Логика работы

### 3.1 AI-агентный цикл (grokService.ts)

```
1. Формируем messages: [system, ...history, user]
2. Цикл до 4 итераций:
   a. Groq API → choices[0]
   b. finish_reason == "stop" → вернуть текст
   c. finish_reason == "tool_calls" → выполнить инструменты
      - Если вызван ACTION-инструмент (room_service, housekeeping,
        taxi, wake_up, excursion, escalate) → запросить финальный
        ответ БЕЗ tools и выйти из цикла
      - Иначе → добавить результаты в messages, продолжить
   d. После 4 итераций без ответа → принудительный финальный вызов
3. Обновляем историю (последние 40 сообщений)
```

**Защита от 400-ошибки Groq:** если llama malforms tool call name
(вставляет JSON прямо в имя функции) — автоматически повторяет запрос
без инструментов.

### 3.2 Инструменты (12 штук)

| Инструмент           | Действие                                  | Уведомление → |
|----------------------|-------------------------------------------|---------------|
| get_booking          | Данные брони из CheckInn (или mock)       | —             |
| create_room_service  | Создать заказ еды → БД                    | KITCHEN       |
| create_housekeeping  | Задача уборки/полотенец → БД              | HOUSEKEEPING  |
| arrange_taxi         | Заказ такси                               | RECEPTION     |
| get_city_info        | Рестораны, места, транспорт Душанбе       | —             |
| get_exchange_rate    | Курс USD/RUB/EUR/CNY/GBP к сомони TJS    | —             |
| escalate_to_staff    | Жалобы, экстренные ситуации               | RECEPTION/GM  |
| create_upsell        | SPA, апгрейд, поздний выезд               | —             |
| get_restaurant_menu  | Меню ресторана AMMAR                      | —             |
| request_wake_up      | Звонок-побудка                            | RECEPTION     |
| arrange_excursion    | Экскурсии по Таджикистану                 | RECEPTION     |
| get_weather          | Погода в Душанбе (статичный mock)         | —             |

### 3.3 Обнаружение языка

Telegram: функция `detectLanguage()` в `telegramHandler.ts`:
- Иероглифы `[一-龥]` → chinese
- Кириллица + таджикские слова-триггеры → tajik
- Кириллица (остальное) → russian
- Всё остальное → english

WhatsApp: **всегда "russian"** (см. Баги ниже).

### 3.4 Формат уведомлений персонала (staffNotifier.ts)

```
🍽 ЗАКАЗ В НОМЕР [19:15]         🧹 УБОРКА [19:15]
🚪 Номер: 212                    🚪 Номер: 212
📋 2× Чай зелёный                Обычный приоритет
⏱ Доставить: СЕЙЧАС              🔖 ID: HK-1777299600681
🔖 ID: RS-1777299599284
```

Валидация: `chat_id` принимается только если `/^-?\d+$/` — защита от
отправки на строки-заглушки типа `ВСТАВИТЬ_ID`.

---

## 4. Запуск и деплой

### Локальная разработка

```bash
# Установка зависимостей
npm install

# Настройка окружения
cp .env.example .env
# Заполнить: GROQ_API_KEY, TELEGRAM_BOT_TOKEN, STAFF_BOT_TOKEN,
#            STAFF_CHAT_KITCHEN/HOUSEKEEPING/RECEPTION/GM

# Получить ID групп персонала (после добавления @AMMARStaffBot в группы)
npx tsx scripts/get-staff-chat-ids.ts

# Запуск с hot reload
npm run dev        # tsx watch src/server/index.ts

# Полный тест сценария
npx tsx scripts/test-full-scenario.ts
```

### Продакшн-билд

```bash
npm run build      # tsc → dist/
npm start          # node dist/server/index.js
```

### Деплой на VPS (рекомендуется Ubuntu 22.04)

```bash
# 1. Установить Node.js 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | bash
apt install -y nodejs

# 2. Клонировать проект, npm install, заполнить .env

# 3. PM2 для автоперезапуска
npm install -g pm2
pm2 start dist/server/index.js --name ammar-bot
pm2 save
pm2 startup

# 4. (Опционально) Nginx reverse proxy для /api/chat
```

### Переключение на реальные сервисы

| Сервис     | Что сделать                                                        |
|------------|--------------------------------------------------------------------|
| PostgreSQL | Установить Prisma, заменить `src/utils/db.ts` на реальный клиент  |
| Redis      | Раскомментировать Redis-код в `src/utils/redis.ts`                |
| CheckInn   | Задать `CHECKINN_ENABLED=true`, `CHECKINN_API_URL`, `CHECKINN_API_KEY` |
| WhatsApp   | Задать `ENABLE_WHATSAPP=true`, запустить на VPS (нужен Puppeteer) |

---

## 5. Известные баги и нерешённые задачи

### 🔴 Критические

**BUG-01 — `whatsappHandler.ts:41`: `roomMatch[1]` всегда `undefined`**  
Регулярка `/^\d{3,4}$/` не имеет capture-группы, поэтому `[1]` — всегда
`undefined`. Комната никогда не сохраняется в сессию через WhatsApp.  
Фикс: заменить `roomMatch[1]` на `roomMatch[0]`.

```typescript
// ❌ Сейчас
const room = roomMatch[1];
// ✅ Исправить
const room = roomMatch[0];
```

**BUG-02 — Нет определения языка в WhatsApp**  
`whatsappHandler.ts` всегда ставит `language: "russian"`. Китайские и
таджикские гости получат ответ на русском до первого обращения.  
Фикс: импортировать и использовать `detectLanguage()` из `telegramHandler.ts`.

### 🟡 Некритические

**BUG-03 — `checkinn.ts` не используется в executor для записи заказов**  
`executor.ts` вызывает `checkinn.getBooking()`, но `createOrder()` и
`createTask()` никогда не вызываются — данные пишутся только в Prisma-заглушку.

**BUG-04 — Groq tool-loop для чистых приветствий**  
`"你好"` / `"Привет"` → модель вызывает 4+ информационных инструмента
подряд вместо простого ответа. Частично решено принудительным финальным
запросом после исчерпания итераций, но ответ может быть нерелевантным.

**BUG-05 — Статичные данные в нескольких инструментах**  
`get_weather`, `get_exchange_rate`, `get_city_info` — возвращают
захардкоженные данные. Погода и курсы устаревают.  
Фикс: подключить openweathermap.org и НБТ API (nbti.tj).

**BUG-06 — `"strict": false` в tsconfig.json**  
TypeScript не проверяет `null`/`undefined`. Скрыты потенциальные
NullPointerException в рантайме.

**BUG-07 — Сессии и история сбрасываются при перезапуске**  
`redis.ts` хранит данные в `Map` — при рестарте процесса все гости
теряют контекст разговора.

**BUG-08 — Нет process manager**  
Нет PM2/systemd. При падении бот не перезапустится автоматически.

**BUG-09 — Rate limiting не распространяется на Telegram polling**  
`express-rate-limit` защищает только `/api/chat`. Telegram-бот работает
через polling без ограничений на количество обращений к AI.

**BUG-10 — `CHECKINN_API_URL` и `CHECKINN_API_KEY` не заданы в `.env`**  
Если `CHECKINN_ENABLED=true` без этих переменных — `axios.get(undefined/...)`
вызовет runtime-ошибку.

**BUG-11 — WhatsApp тянет Puppeteer (~300MB Chromium) даже при `ENABLE_WHATSAPP=false`**  
`whatsapp-web.js` в `dependencies`, а не `optionalDependencies`.

**TODO-01 — Нет Webhook-режима для Telegram**  
Сейчас long polling — работает, но для продакшна предпочтительнее webhook
(меньше задержка, меньше нагрузка на сеть).

**TODO-02 — Нет логирования в файл**  
Winston настроен только на Console transport. В продакшне нужен
`DailyRotateFile` для хранения логов.

**TODO-03 — Нет мониторинга health-check от внешних систем**  
`GET /health` есть, но нет интеграции с UptimeRobot / Grafana / etc.

---

## 6. Быстрый старт для нового разработчика

```
1. Прочитать .env — все ключи объяснены в комментариях
2. Точка входа: src/server/index.ts
3. Весь AI: src/ai/grokService.ts (агентный цикл) + src/config/systemPrompt.ts
4. Добавить новый инструмент:
   a. src/config/tools.ts — добавить JSON-схему
   b. src/tools/executor.ts — добавить case в switch
   c. Если уведомление персонала — вызвать notifyStaff()
5. npm run dev — запустить, логи в консоли
```

---

*Отчёт актуален на момент анализа. При значительных изменениях кодовой базы требует обновления.*
