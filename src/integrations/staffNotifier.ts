// src/integrations/staffNotifier.ts
// Уведомления персонала через @AMMARStaffBot

import axios from "axios";
import { logger } from "../utils/logger";

type Channel =
  | "kitchen"
  | "housekeeping"
  | "reception"
  | "gm"
  | "emergency"
  | "late_checkout"
  | "room_extension"
  | "human_escalation";

// Telegram chat ID — целое число (отрицательное для групп).
// Возвращает строку только если значение похоже на реальный ID.
function resolveId(raw: string | undefined): string | null {
  if (!raw) return null;
  return /^-?\d+$/.test(raw.trim()) ? raw.trim() : null;
}

const CHANNEL_ENV: Record<Channel, string> = {
  kitchen:          "STAFF_CHAT_KITCHEN",
  housekeeping:     "STAFF_CHAT_HOUSEKEEPING",
  reception:        "STAFF_CHAT_RECEPTION",
  gm:               "STAFF_CHAT_GM",
  emergency:        "STAFF_CHAT_GM",        // Экстренные → GM
  late_checkout:    "STAFF_CHAT_RECEPTION", // Поздний выезд → Ресепшн
  room_extension:   "STAFF_CHAT_RECEPTION", // Продление → Ресепшн
  human_escalation: "STAFF_CHAT_RECEPTION", // Эскалация к человеку → Ресепшн
};

export async function notifyStaff(
  channel: Channel,
  data: Record<string, any>
): Promise<void> {
  const token  = process.env.STAFF_BOT_TOKEN;
  const chatId = resolveId(process.env[CHANNEL_ENV[channel]]);

  if (!token || !chatId) {
    logger.warn(
      `📢 [STAFF/${channel.toUpperCase()}] chat ID не задан (${CHANNEL_ENV[channel]}). ` +
      `Добавьте в .env реальный ID группы.`,
      data,
    );
    return;
  }

  const text = formatMessage(channel, data);

  try {
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id:    chatId,
      text,
      parse_mode: "HTML",
    }, { timeout: 8000 });
    logger.info(`✅ Staff/${channel} notified`, { room: data.room, chatId });
  } catch (err: any) {
    const status = err.response?.status;
    const desc   = err.response?.data?.description ?? err.message;
    logger.error(`❌ Staff/${channel} send failed [${status}]: ${desc}`);
  }
}

function formatMessage(channel: Channel, d: Record<string, any>): string {
  const ts = new Date().toLocaleTimeString("ru-RU", { timeZone: "Asia/Dushanbe" });

  switch (channel) {
    case "kitchen":
      return (
        `🍽 <b>ЗАКАЗ В НОМЕР</b> [${ts}]\n` +
        `🚪 Номер: <b>${d.room}</b>\n` +
        `📋 ${d.items}\n` +
        `⏱ Доставить: ${d.time || "СЕЙЧАС"}\n` +
        `🔖 ID: ${d.orderId}`
      );

    case "housekeeping":
      return (
        `${d.type} [${ts}]\n` +
        `🚪 Номер: <b>${d.room}</b>\n` +
        `${d.priority === "⚡ СРОЧНО" ? "⚡ <b>СРОЧНО!</b>" : "Обычный приоритет"}\n` +
        `${d.note ? "📝 " + d.note + "\n" : ""}` +
        `🔖 ID: ${d.taskId}`
      );

    case "late_checkout":
      return (
        `🔔 <b>Запрос на поздний выезд</b> [${ts}]\n` +
        `🚪 Номер: <b>${d.room}</b>\n` +
        `🕐 Время выезда: до <b>${d.checkout_time}</b>\n` +
        `❗ Требуется подтверждение\n` +
        `🔖 ID: ${d.requestId}`
      );

    case "room_extension":
      return (
        `📅 <b>Запрос на продление номера</b> [${ts}]\n` +
        `🚪 Номер: <b>${d.room}</b>\n` +
        `🌙 Дополнительных ночей: <b>${d.extra_nights}</b>\n` +
        `📆 Новая дата выезда: ${d.new_checkout_date || "уточнить"}\n` +
        `❗ Требуется подтверждение и расчёт стоимости\n` +
        `🔖 ID: ${d.requestId}`
      );

    case "human_escalation":
      return (
        `🧑‍💼 <b>ЗАПРОС ЖИВОГО АДМИНИСТРАТОРА</b> [${ts}]\n` +
        `🚪 Номер: <b>${d.room}</b>${d.guest !== "Гость" ? ` | Гость: ${d.guest}` : ""}\n` +
        `📱 Платформа: ${d.platform}\n` +
        `${d.priority === "urgent" ? "⚡ <b>СРОЧНО</b>\n" : ""}` +
        `📝 Причина: ${d.reason}\n` +
        `💬 Сообщение гостя: <i>${d.guest_message}</i>\n` +
        `🔖 ID: ${d.requestId}`
      );

    case "reception":
      return (
        `📞 <b>${d.type}</b> [${ts}]\n` +
        `🚪 Номер: <b>${d.room}</b>\n` +
        Object.entries(d)
          .filter(([k]) => !["type", "room"].includes(k))
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n")
      );

    case "gm":
      return (
        `📊 <b>GM УВЕДОМЛЕНИЕ</b> [${ts}]\n` +
        Object.entries(d).map(([k, v]) => `${k}: ${v}`).join("\n")
      );

    case "emergency":
      return (
        `🚨 <b>ЭКСТРЕННЫЙ ВЫЗОВ</b> [${ts}]\n` +
        `🚪 Номер: <b>${d.room}</b>\n` +
        `❗ ${d.reason || d.summary}\n` +
        `<b>ТРЕБУЕТСЯ НЕМЕДЛЕННОЕ РЕАГИРОВАНИЕ</b>`
      );

    default:
      return JSON.stringify(d);
  }
}
