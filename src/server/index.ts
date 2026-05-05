// src/server/index.ts — Главная точка входа
import "dotenv/config";
import path from "path";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { createTelegramBot, getTelegramBot } from "../bot/telegramHandler";
import { notifyStaff }                       from "../integrations/staffNotifier";
import { logger }                            from "../utils/logger";
import { getAllSessions, getHistoryByKey }   from "../utils/redis";
import { getStats }                          from "../utils/stats";
import { addSSEClient, removeSSEClient }     from "../utils/adminEvents";

// Domains allowed to call /api/* from a browser
const ALLOWED_ORIGINS = [
  "https://ammar.tj",
  "https://www.ammar.tj",
  // Railway deployment URL (set automatically by Railway, or override via env)
  ...(process.env.RAILWAY_PUBLIC_DOMAIN
    ? [`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`]
    : []),
  ...(process.env.ALLOWED_ORIGIN
    ? [process.env.ALLOWED_ORIGIN]
    : []),
];

const app = express();

// Allow inline scripts/styles so the bundled chat widget works
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'"],
      styleSrc:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc:    ["'self'", "https://fonts.gstatic.com"],
      imgSrc:     ["'self'", "data:"],
      connectSrc: ["'self'"],
    },
  },
}));

app.use(cors({
  origin(origin, cb) {
    // No origin = server-to-server / curl / Postman — allow
    if (!origin) return cb(null, true);
    // Whitelisted production domains
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    // Any localhost port for local development
    if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return cb(null, true);
    cb(new Error(`CORS: ${origin} not allowed`));
  },
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"],
}));

app.use(express.json({ limit: "1mb" }));
app.use(rateLimit({ windowMs: 60_000, max: 100, standardHeaders: true, legacyHeaders: false }));

// Serve chat widget: GET / → public/index.html
app.use(express.static(path.join(__dirname, "../../public")));

// ── Health check ──────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({
    status:  "ok",
    service: "AMMAR Hotel AI Bot",
    engine:  "Groq (groq.com)",
    model:   process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    uptime:  Math.round(process.uptime()) + "s",
  });
});

// ── Admin auth middleware ─────────────────────────────────────────
function adminAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace("Bearer ", "").trim()
             || req.query.token as string;
  if (token && token === process.env.ADMIN_PASSWORD) return next();
  res.status(401).json({ error: "Unauthorized" });
}

// ── Admin API routes ──────────────────────────────────────────────

// GET /api/admin/guests — список активных сессий
app.get("/api/admin/guests", adminAuth, (_req, res) => {
  res.json(getAllSessions());
});

// GET /api/admin/history/:sessionId — история диалога
app.get("/api/admin/history/:sessionId", adminAuth, (req, res) => {
  const history = getHistoryByKey(String(req.params.sessionId));
  res.json(history);
});

// GET /api/admin/stats — статистика за сегодня
app.get("/api/admin/stats", adminAuth, (_req, res) => {
  res.json(getStats());
});

// POST /api/admin/send/:sessionId — отправить сообщение гостю
app.post("/api/admin/send/:sessionId", adminAuth, async (req, res) => {
  const { message } = req.body as { message?: string };
  if (!message) return res.status(400).json({ error: "message required" });

  const sessionId = String(req.params.sessionId);
  // sessionId format: tg_<userId>
  if (sessionId.startsWith("tg_")) {
    const userId = sessionId.replace("tg_", "");
    const bot = getTelegramBot();
    if (!bot) return res.status(503).json({ error: "Telegram bot not running" });
    try {
      await bot.api.sendMessage(userId, `👔 *Сообщение от менеджера:*\n${message}`, { parse_mode: "Markdown" });
      res.json({ ok: true });
    } catch (err: any) {
      logger.error("Admin send failed", { err: err.message });
      res.status(500).json({ error: err.message });
    }
  } else {
    res.status(400).json({ error: "Only Telegram sessions supported" });
  }
});

// GET /api/admin/events — SSE realtime stream
app.get("/api/admin/events", adminAuth, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  addSSEClient(res);

  // Heartbeat every 25 s to keep connection alive through proxies
  const hb = setInterval(() => {
    try { res.write(": heartbeat\n\n"); } catch { /* client gone */ }
  }, 25_000);

  req.on("close", () => {
    clearInterval(hb);
    removeSSEClient(res);
  });
});

// GET /admin → serve admin.html (no auth — HTML handles it client-side)
app.get("/admin", (_req, res) => {
  res.sendFile(path.join(__dirname, "../../public/admin.html"));
});

// ── Web Chat API ──────────────────────────────────────────────────
app.post("/api/chat", async (req, res) => {
  try {
    const { message, sessionId, roomNumber, guestName, language } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "message required" });
    }

    const { chat }                                                         = await import("../ai/grokService");
    const { getSession, setSession, updateSession, getHistory, setHistory } = await import("../utils/redis");
    const { detectLanguage }                                               = await import("../utils/detectLanguage");

    // Stable key: client supplies sid after first call, we generate one otherwise
    const sid = sessionId && /^[\w-]{4,64}$/.test(sessionId)
      ? sessionId
      : `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const key = `web_${sid}`;

    let session = await getSession(key);

    if (!session) {
      const lang = (language as any) || detectLanguage(message);
      session = {
        guestId:    key,
        roomNumber: roomNumber || undefined,
        guestName:  guestName  || undefined,
        language:   lang,
        platform:   "web",
        createdAt:  new Date().toISOString(),
      };
      await setSession(key, session);

      // Let reception know a guest opened the web widget
      if (session.roomNumber) {
        notifyStaff("reception", {
          type: "🌐 Гость начал чат (WEB)",
          room: session.roomNumber,
          lang: session.language,
        }).catch(() => {/* non-critical */});
      }
    } else if (language && language !== session.language) {
      // Honour explicit language switch from the widget
      await updateSession(key, { language: language as any });
      session = { ...session, language: language as any };
    }

    const history = await getHistory(key);
    const { reply, updatedHistory } = await chat(message, history, {
      guestId:    session.guestId,
      roomNumber: session.roomNumber,
      guestName:  session.guestName,
      language:   session.language,
      platform:   "web",
    });

    await setHistory(key, updatedHistory);
    res.json({ reply, sessionId: sid });

  } catch (err: any) {
    logger.error("Web chat error", { err: err.message });
    res.status(500).json({ error: "Internal error" });
  }
});

// ── Boot ──────────────────────────────────────────────────────────
async function main() {
  const PORT = parseInt(process.env.PORT || "3000");
  app.listen(PORT, () => logger.info(`🚀 Server started on :${PORT}`));

  // Telegram
  if (process.env.TELEGRAM_BOT_TOKEN) {
    const bot = createTelegramBot();
    bot.start({ onStart: (info) => { logger.info(`✅ Telegram: @${info.username}`); } })
      .catch((err) => logger.error("Telegram bot crashed", { err: err.message }));
  } else {
    logger.warn("⚠️  TELEGRAM_BOT_TOKEN not set");
  }

  // WhatsApp (disabled by default — requires Chromium, use ENABLE_WHATSAPP=true)
  if (process.env.ENABLE_WHATSAPP === "true") {
    const { createWhatsAppClient } = await import("../bot/whatsappHandler");
    const wa = createWhatsAppClient();
    await wa.initialize();
    logger.info("📱 WhatsApp initializing...");
  }

  logger.info("🏨 AMMAR Hotel Bot ready", {
    ai:       "Groq (groq.com)",
    web:      `http://localhost:${process.env.PORT || 3000}`,
    telegram: !!process.env.TELEGRAM_BOT_TOKEN,
    whatsapp: process.env.ENABLE_WHATSAPP === "true",
  });
}

main().catch((err) => { logger.error("Fatal", { err: err.message }); process.exit(1); });
