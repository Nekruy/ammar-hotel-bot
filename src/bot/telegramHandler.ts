// src/bot/telegramHandler.ts — Telegram бот для гостей
import { Bot } from "grammy";
import { chat, GuestCtx } from "../ai/grokService";
import { getSession, setSession, getHistory, setHistory, Session } from "../utils/redis";
import { detectLanguage } from "../utils/detectLanguage";
import { logger } from "../utils/logger";

const WELCOME_MESSAGE =
  `🏨 *Добро пожаловать в AMMAR Hotel!*\n\n` +
  `Меня зовут Ammar AI — ваш персональный консьерж.\n\n` +
  `*Я умею:*\n` +
  `🍽 Заказать еду и напитки прямо в номер\n` +
  `🛎 Вызвать горничную (уборка, полотенца, фен)\n` +
  `🚕 Организовать такси или трансфер в аэропорт\n` +
  `🏙 Рассказать о лучших местах Душанбе\n` +
  `💱 Показать курс валют (USD, RUB, EUR)\n` +
  `🕐 Оформить поздний выезд (Late Checkout)\n` +
  `🔑 Продление проживания\n` +
  `📋 Информация о вашей брони\n` +
  `⏰ Поставить звонок-побудку\n` +
  `🏔 Организовать экскурсию по Таджикистану\n` +
  `☀️ Погода в Душанбе\n\n` +
  `*Напишите номер вашей комнаты чтобы начать.*\n` +
  `Пример: \`412\``;

let _botRef: Bot | null = null;
export const getTelegramBot = (): Bot | null => _botRef;

export function createTelegramBot(): Bot {
  const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!);
  _botRef = bot;

  // /start
  bot.command("start", async (ctx) => {
    const uid     = String(ctx.from?.id);
    const session = await getSession(`tg_${uid}`);
    if (session?.roomNumber) {
      await ctx.reply(
        `🏨 Добро пожаловать обратно! Вы в номере *${session.roomNumber}*.\n` +
        `Просто скажите что нужно — я всё сделаю сам 😊`,
        { parse_mode:"Markdown" }
      );
    } else {
      await ctx.reply(WELCOME_MESSAGE, { parse_mode:"Markdown" });
    }
  });

  // /menu — список услуг на языке гостя
  bot.command("menu", async (ctx) => {
    const uid     = String(ctx.from?.id);
    const session = await getSession(`tg_${uid}`);
    const lang    = session?.language || "russian";

    const menus: Record<string, string> = {
      russian: WELCOME_MESSAGE,

      tajik:
        `🏨 *Хуш омадед ба AMMAR Hotel!*\n\n` +
        `Ман Ammar AI — консьержи шахсии шумо.\n\n` +
        `*Ман метавонам:*\n` +
        `🍽 Хӯрок ва нӯшокӣ ба хона фармоиш диҳам\n` +
        `🛎 Хизматчиро даъват кунам (тозакунӣ, ҳавлӯ, фен)\n` +
        `🚕 Таксӣ ё трансфер ба фурудгоҳ ташкил кунам\n` +
        `🏙 Дар бораи ҷойҳои беҳтарини Душанбе нақл кунам\n` +
        `💱 Курси асъорро нишон диҳам (USD, RUB, EUR)\n` +
        `🕐 Баромади дер аз меҳмонхона (Late Checkout)\n` +
        `🔑 Дароз кардани истиқомат\n` +
        `📋 Маълумот дар бораи брони шумо\n` +
        `⏰ Бедоркунӣ аз ресепшн\n` +
        `🏔 Экскурсия ба Тоҷикистон ташкил кунам\n` +
        `☀️ Обу ҳаво дар Душанбе\n\n` +
        `*Рақами ҳуҷраи худро нависед.*\nМисол: \`412\``,

      english:
        `🏨 *Welcome to AMMAR Hotel!*\n\n` +
        `I'm Ammar AI — your personal concierge.\n\n` +
        `*I can help you with:*\n` +
        `🍽 Order food & drinks to your room\n` +
        `🛎 Housekeeping (cleaning, towels, hairdryer)\n` +
        `🚕 Taxi or airport transfer\n` +
        `🏙 Best places to visit in Dushanbe\n` +
        `💱 Currency exchange rates (USD, RUB, EUR)\n` +
        `🕐 Late Checkout request\n` +
        `🔑 Room extension\n` +
        `📋 Your booking information\n` +
        `⏰ Wake-up call\n` +
        `🏔 Excursions across Tajikistan\n` +
        `☀️ Weather in Dushanbe\n\n` +
        `*Please send your room number to get started.*\nExample: \`412\``,

      chinese:
        `🏨 *欢迎来到AMMAR Hotel！*\n\n` +
        `我是Ammar AI — 您的私人礼宾。\n\n` +
        `*我可以帮您：*\n` +
        `🍽 订餐送到房间\n` +
        `🛎 客房服务（清洁、毛巾、吹风机）\n` +
        `🚕 出租车或机场接送\n` +
        `🏙 杜尚别最佳景点推荐\n` +
        `💱 货币汇率（美元、卢布、欧元）\n` +
        `🕐 晚退房申请\n` +
        `🔑 延长入住\n` +
        `📋 您的预订信息\n` +
        `⏰ 叫醒服务\n` +
        `🏔 塔吉克斯坦游览\n` +
        `☀️ 杜尚别天气\n\n` +
        `*请发送您的房间号开始服务。*\n例如：\`412\``,
    };

    const text = menus[lang] ?? menus.russian;
    try {
      await ctx.reply(text, { parse_mode: "Markdown" });
    } catch {
      await ctx.reply(text);
    }
  });

  // /reset — очистить историю
  bot.command("reset", async (ctx) => {
    const uid = String(ctx.from?.id);
    await setHistory(`tg_${uid}`, []);
    await ctx.reply("✅ История очищена. Напишите номер комнаты заново.");
  });

  // Главный обработчик сообщений
  bot.on("message:text", async (ctx) => {
    const uid  = String(ctx.from?.id);
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return;

    const key     = `tg_${uid}`;
    let session   = await getSession(key);

    // Нет сессии — принимаем номер комнаты
    if (!session) {
      const roomMatch = text.match(/^(\d{3,4})$/);
      if (roomMatch) {
        const room = roomMatch[1];
        const newSession: Session = {
          guestId:   `tg_${uid}`,
          roomNumber: room,
          language:  detectLanguage(text),
          platform:  "telegram",
          createdAt: new Date().toISOString(),
        };
        await setSession(key, newSession);
        await ctx.reply(
          `✅ Номер *${room}* привязан!\n\n` +
          `Я Ammar AI — ваш консьерж 24/7 🏨\n` +
          `Просто скажите мне что вам нужно — я всё пойму сам! 😊`,
          { parse_mode:"Markdown" }
        );
        return;
      }
      await ctx.reply(
        `Добро пожаловать! Пожалуйста, *напишите номер вашей комнаты*.\nПример: \`412\``,
        { parse_mode:"Markdown" }
      );
      return;
    }

    // Показываем что печатаем
    await ctx.replyWithChatAction("typing");

    const guestCtx: GuestCtx = {
      guestId:    session.guestId,
      roomNumber: session.roomNumber,
      guestName:  session.guestName,
      language:   session.language || "russian",
      platform:   "telegram",
      checkIn:    session.checkIn,
      checkOut:   session.checkOut,
    };

    const history = await getHistory(key);

    try {
      const { reply, updatedHistory } = await chat(text, history, guestCtx);
      await setHistory(key, updatedHistory);

      // Telegram Markdown может ломаться — ловим ошибку
      try {
        await ctx.reply(reply, { parse_mode: "Markdown" });
      } catch {
        await ctx.reply(reply); // без форматирования
      }

      logger.info("TG reply sent", { room: session.roomNumber, len: reply.length });
    } catch (err: any) {
      logger.error("TG chat error", { err: err.message, uid });
      await ctx.reply("Извините, ошибка. Позвоните на ресепшн: 0");
    }
  });

  // Фото
  bot.on("message:photo", async (ctx) => {
    await ctx.reply("Фото получено 📸\nДля передачи документов обратитесь на ресепшн (тел. 0).");
  });

  bot.catch((err) => logger.error("Bot error", { err: err.message }));

  return bot;
}

