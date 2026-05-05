#!/usr/bin/env tsx
/**
 * Запустить: npx tsx scripts/get-staff-chat-ids.ts
 *
 * Что делает:
 *  1. Ждёт новых сообщений от Staff Bot (long polling).
 *  2. Выводит chat_id каждого чата, в котором написали или в который добавили бота.
 *  3. Пишет строки для .env когда накопится хотя бы один ID.
 *
 * Как использовать:
 *  1. Создайте группы в Telegram: КУХНЯ, ХАУСКИПИНГ, РЕСЕПШН, GM.
 *  2. Добавьте @AMMARStaffBot в каждую группу.
 *  3. Напишите любое сообщение в каждой группе (или перешлите боту сообщение из группы).
 *  4. Скопируйте выведенные chat_id в .env.
 */

import * as fs from "fs";
import * as path from "path";

const TOKEN = process.env.STAFF_BOT_TOKEN ?? (() => {
  // Попробуем прочитать из .env
  const envPath = path.resolve(__dirname, "../.env");
  if (fs.existsSync(envPath)) {
    const line = fs.readFileSync(envPath, "utf8")
      .split("\n")
      .find((l) => l.startsWith("STAFF_BOT_TOKEN="));
    return line?.split("=")[1]?.trim();
  }
  return undefined;
})();

if (!TOKEN) {
  console.error("❌ STAFF_BOT_TOKEN не найден. Укажите в .env или как переменную окружения.");
  process.exit(1);
}

const API = `https://api.telegram.org/bot${TOKEN}`;

interface Update {
  update_id: number;
  message?: {
    chat: { id: number; title?: string; type: string };
    from?: { username?: string; first_name?: string };
    text?: string;
    new_chat_members?: { id: number; username?: string; is_bot: boolean }[];
  };
  my_chat_member?: {
    chat: { id: number; title?: string; type: string };
    new_chat_member: { status: string };
  };
}

async function getUpdates(offset: number): Promise<Update[]> {
  const url = `${API}/getUpdates?offset=${offset}&timeout=30&allowed_updates=message,my_chat_member`;
  const res = await fetch(url);
  const json = (await res.json()) as { ok: boolean; result: Update[] };
  if (!json.ok) throw new Error(`Telegram error: ${JSON.stringify(json)}`);
  return json.result;
}

const seen = new Map<number, string>(); // chatId → title

function printEnv(): void {
  console.log("\n─── Скопируйте в .env ───────────────────────────────");
  for (const [id, title] of seen) {
    console.log(`# ${title}`);
    console.log(`STAFF_CHAT_???=${id}   # замените ??? на KITCHEN / HOUSEKEEPING / RECEPTION / GM`);
  }
  console.log("─────────────────────────────────────────────────────\n");
}

async function main(): Promise<void> {
  console.log(`✅ Staff Bot: @AMMARStaffBot (${TOKEN!.slice(0, 10)}...)`);
  console.log("⏳ Ожидаю сообщений… Добавьте бота в группы и напишите там что-нибудь.\n");

  let offset = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const updates = await getUpdates(offset);

    for (const upd of updates) {
      offset = upd.update_id + 1;

      const chat = upd.message?.chat ?? upd.my_chat_member?.chat;
      if (!chat) continue;

      if (!seen.has(chat.id)) {
        seen.set(chat.id, chat.title ?? String(chat.id));
        const who = upd.message?.from?.username
          ? `@${upd.message.from.username}`
          : upd.message?.from?.first_name ?? "бот добавлен";
        console.log(`📬 Новый чат обнаружен:`);
        console.log(`   Тип   : ${chat.type}`);
        console.log(`   Название: ${chat.title ?? "(нет)"}`);
        console.log(`   Chat ID : ${chat.id}   ← это и нужно в .env`);
        console.log(`   От: ${who}`);
        console.log();
        printEnv();
      }
    }
  }
}

main().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});
