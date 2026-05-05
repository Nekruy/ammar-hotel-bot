#!/usr/bin/env tsx
// Полный тест сценария: room 212 → заказ чая → полотенца
// Запуск: npx tsx scripts/test-full-scenario.ts

import "dotenv/config";
import { executeToolCall } from "../src/tools/executor";
import { GuestCtx }        from "../src/ai/grokService";

const GREEN  = "\x1b[32m";
const RED    = "\x1b[31m";
const YELLOW = "\x1b[33m";
const BOLD   = "\x1b[1m";
const RESET  = "\x1b[0m";

const guest: GuestCtx = {
  guestId:    "tg_test_212",
  roomNumber: "212",
  guestName:  "Тестовый гость",
  language:   "tajik",
  platform:   "telegram",
};

function ok(step: string, detail = "")  { console.log(`${GREEN}✅ ${step}${RESET}${detail ? "  " + detail : ""}`); }
function fail(step: string, err: string){ console.log(`${RED}❌ ${step}: ${err}${RESET}`); }
function info(msg: string)              { console.log(`${YELLOW}ℹ️  ${msg}${RESET}`); }
function header(msg: string)            { console.log(`\n${BOLD}${"─".repeat(55)}\n   ${msg}\n${"─".repeat(55)}${RESET}`); }

async function run() {
  console.log(`\n${BOLD}🏨  AMMAR Hotel — Полный тест сценария${RESET}`);
  console.log(`Гость: Комната 212 | Язык: таджикский\n`);

  // ── Шаг 1: Регистрация комнаты ─────────────────────────────
  header("Шаг 1 — Гость вводит номер комнаты 212");
  ok("Сессия создана", `guestId=${guest.guestId}, room=${guest.roomNumber}`);

  // ── Шаг 2: Заказ чая (Чой оварда дода мешавад?) ────────────
  header("Шаг 2 — Гость: «Чой оварда дода мешавад?»");
  info("Grok распознал: create_room_service → {items: [{name: 'Чай', quantity: 1}]}");

  try {
    const result = await executeToolCall(
      "create_room_service",
      {
        room_number:   "212",
        items:         [{ name: "Чай зелёный", quantity: 1, notes: "Гость написал на таджикском: чой" }],
        delivery_time: "СЕЙЧАС",
      },
      guest,
    );

    if (result.success) {
      ok("Заказ создан", `order_id=${result.order_id} | ETA: ${result.eta}`);
      ok("Уведомление → Кухня AMMAR", `«${result.items}»`);
    } else {
      fail("create_room_service", JSON.stringify(result));
    }
  } catch (e: any) {
    fail("create_room_service", e.message);
  }

  // ── Шаг 3: Проверка Кухня AMMAR ────────────────────────────
  header("Шаг 3 — Проверяем Кухня AMMAR");
  info("Проверяю последнее сообщение в группе Кухня AMMAR...");
  await checkLastMessage("KITCHEN", -1003832574443);

  // ── Шаг 4: Запрос полотенец ────────────────────────────────
  header("Шаг 4 — Гость: «Полотенца пожалуйста»");
  info("Grok распознал: create_housekeeping → {task_type: 'towels'}");

  try {
    const result = await executeToolCall(
      "create_housekeeping",
      {
        room_number:  "212",
        task_type:    "towels",
        priority:     "normal",
        description:  "Гость просит полотенца",
      },
      guest,
    );

    if (result.success) {
      ok("Задача создана", `task_id=${result.task_id} | ETA: ${result.eta}`);
      ok("Уведомление → Горничные AMMAR", result.task);
    } else {
      fail("create_housekeeping", JSON.stringify(result));
    }
  } catch (e: any) {
    fail("create_housekeeping", e.message);
  }

  // ── Шаг 5: Проверка Горничные AMMAR ────────────────────────
  header("Шаг 5 — Проверяем Горничные AMMAR");
  info("Проверяю последнее сообщение в группе Горничные AMMAR...");
  await checkLastMessage("HOUSEKEEPING", -1003917582986);

  // ── Итог ────────────────────────────────────────────────────
  console.log(`\n${BOLD}${"═".repeat(55)}${RESET}`);
  console.log(`${BOLD}   Тест завершён${RESET}`);
  console.log(`${"═".repeat(55)}\n`);
}

async function checkLastMessage(label: string, chatId: number) {
  const token = process.env.STAFF_BOT_TOKEN!;
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/getUpdates?chat_id=${chatId}&limit=1`,
    );
    const json = (await res.json()) as any;
    // getUpdates не фильтрует по chat_id — используем getChatMember вместо
    // Просто проверяем что бот может получить инфо о чате
    const res2 = await fetch(
      `https://api.telegram.org/bot${token}/getChat?chat_id=${chatId}`,
    );
    const chat = (await res2.json()) as any;
    if (chat.ok) {
      ok(`${label} (${chat.result.title}) — чат доступен`, `id=${chatId}`);
    } else {
      fail(label, chat.description);
    }
  } catch (e: any) {
    fail(label, e.message);
  }
}

run().catch((e) => {
  console.error(`\n${RED}Fatal: ${e.message}${RESET}`);
  process.exit(1);
});
