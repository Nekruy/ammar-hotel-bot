// src/bot/whatsappHandler.ts — WhatsApp бот
import { Client, LocalAuth } from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import { chat, GuestCtx } from "../ai/grokService";
import { getSession, setSession, getHistory, setHistory, Session } from "../utils/redis";
import { detectLanguage } from "../utils/detectLanguage";
import { logger } from "../utils/logger";

export function createWhatsAppClient(): Client {
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: "./whatsapp-session" }),
    puppeteer: {
      headless: true,
      args: ["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage"],
    },
  });

  client.on("qr", (qr) => {
    console.log("\n📱 СКАНИРУЙТЕ QR-КОД В WHATSAPP:\n");
    qrcode.generate(qr, { small: true });
    console.log("\nWhatsApp → Настройки → Устройства → Привязать устройство\n");
  });

  client.on("authenticated", () => logger.info("✅ WhatsApp authenticated"));
  client.on("ready",         () => logger.info("✅ WhatsApp ready!"));
  client.on("auth_failure",  (m) => logger.error("❌ WhatsApp auth failed", { m }));
  client.on("disconnected",  (r) => logger.warn("WhatsApp disconnected", { r }));

  client.on("message", async (msg) => {
    if (msg.from.endsWith("@g.us") || msg.from === "status@broadcast") return;
    if (msg.type !== "chat") return;

    const from  = msg.from;
    const text  = msg.body.trim();
    const key   = `wa_${from}`;
    let session = await getSession(key);

    if (!session) {
      const roomMatch = text.match(/^\d{3,4}$/);
      if (roomMatch) {
        const room = roomMatch[0];
        const newSession: Session = {
          guestId:   `wa_${from}`,
          roomNumber: room,
          language:  detectLanguage(text),
          platform:  "whatsapp",
          createdAt: new Date().toISOString(),
        };
        await setSession(key, newSession);
        await msg.reply(`✅ Комната *${room}* привязана!\nМеня зовут Ammar AI — ваш консьерж 24/7 🤖`);
        return;
      }
      await msg.reply(
        `🏨 *AMMAR Hotel — Душанбе*\n\n` +
        `Я ваш AI консьерж Ammar AI.\n` +
        `*Напишите номер вашей комнаты*.\nПример: 412`
      );
      return;
    }

    const guestCtx: GuestCtx = {
      guestId:    session.guestId,
      roomNumber: session.roomNumber,
      guestName:  session.guestName,
      language:   session.language || "russian",
      platform:   "whatsapp",
    };

    const history = await getHistory(key);
    try {
      const { reply, updatedHistory } = await chat(text, history, guestCtx);
      await setHistory(key, updatedHistory);
      // Убираем Markdown — WhatsApp не поддерживает
      await msg.reply(reply.replace(/\*\*(.*?)\*\*/g, "*$1*").replace(/[`]/g,""));
    } catch (err: any) {
      logger.error("WA error", { err: err.message });
      await msg.reply("Извините, ошибка. Позвоните на ресепшн: 0");
    }
  });

  return client;
}
