// src/server/index.ts — Главная точка входа
import "dotenv/config";
import fs   from "fs";
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
import { getFullMenu, setFullMenu }          from "../utils/menuStore";
import { getSystemPrompt, setSystemPrompt, resetSystemPrompt } from "../utils/promptStore";

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
      defaultSrc:    ["'self'"],
      scriptSrc:     ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],  // allow onclick= handlers in admin.html
      styleSrc:      ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc:       ["'self'", "https://fonts.gstatic.com"],
      imgSrc:        ["'self'", "data:"],
      connectSrc:    ["'self'"],
    },
  },
}));

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return cb(null, true);
    cb(new Error(`CORS: ${origin} not allowed`));
  },
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"],
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

// GET /api/admin/hotel-info — read hotel_facts.json
app.get("/api/admin/hotel-info", adminAuth, (_req, res) => {
  try {
    const fp = path.join(__dirname, "../data/hotel_facts.json");
    res.json(JSON.parse(fs.readFileSync(fp, "utf8")));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/hotel-info — overwrite hotel_facts.json
app.post("/api/admin/hotel-info", adminAuth, (req, res) => {
  try {
    const fp = path.join(__dirname, "../data/hotel_facts.json");
    fs.writeFileSync(fp, JSON.stringify(req.body, null, 2), "utf8");
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/scenarios — read scenarios.json
app.get("/api/admin/scenarios", adminAuth, (_req, res) => {
  try {
    const fp = path.join(__dirname, "../data/scenarios.json");
    res.json(JSON.parse(fs.readFileSync(fp, "utf8")));
  } catch {
    res.json({ version: "1.0", updated: "", scenarios: [] });
  }
});

// POST /api/admin/scenarios — overwrite scenarios.json
app.post("/api/admin/scenarios", adminAuth, (req, res) => {
  try {
    const data = req.body;
    data.updated = new Date().toISOString().slice(0, 10);
    const fp = path.join(__dirname, "../data/scenarios.json");
    fs.writeFileSync(fp, JSON.stringify(data, null, 2), "utf8");
    res.json({ ok: true, message: "Датасет обновлён!" });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/admin/menu — current in-memory menu
app.get("/api/admin/menu", adminAuth, (_req, res) => {
  res.json(getFullMenu());
});

// POST /api/admin/menu — update menu at runtime
app.post("/api/admin/menu", adminAuth, (req, res) => {
  try {
    setFullMenu(req.body);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/prompt — current system prompt
app.get("/api/admin/prompt", adminAuth, (_req, res) => {
  res.json({ prompt: getSystemPrompt() });
});

// POST /api/admin/prompt — override or reset system prompt
app.post("/api/admin/prompt", adminAuth, (req, res) => {
  const { prompt, reset } = req.body as { prompt?: string; reset?: boolean };
  if (reset) { resetSystemPrompt(); return res.json({ ok: true, prompt: getSystemPrompt() }); }
  if (prompt) { setSystemPrompt(prompt); return res.json({ ok: true }); }
  res.status(400).json({ error: "prompt or reset required" });
});

// POST /api/admin/test-chat — send test message as a guest (admin tab)
app.post("/api/admin/test-chat", adminAuth, async (req, res) => {
  const { message } = req.body as { message?: string };
  if (!message) return res.status(400).json({ error: "message required" });
  try {
    const { chat } = await import("../ai/grokService");
    const { reply } = await chat(message, [], {
      guestId: "admin_test", roomNumber: "ADMIN", guestName: "Admin",
      language: "russian", platform: "web",
    });
    res.json({ reply });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/test-notify — send test notification to staff
app.post("/api/admin/test-notify", adminAuth, async (req, res) => {
  const { channel = "reception" } = req.body as { channel?: string };
  try {
    await notifyStaff(channel as any, { type: "🧪 ТЕСТ", room: "Admin", message: "Тестовое уведомление из админки" });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Revenue Management API ────────────────────────────────────────
const revData = (file: string) => path.join(__dirname, "../data/" + file);

function readRevJson(file: string, fallback: any = []) {
  try { return JSON.parse(fs.readFileSync(revData(file), "utf8")); } catch { return fallback; }
}
function writeRevJson(file: string, data: any) {
  fs.writeFileSync(revData(file), JSON.stringify(data, null, 2), "utf8");
}

app.get("/api/admin/revenue/competitors", adminAuth, (_req, res) => {
  res.json(readRevJson("competitors.json"));
});

app.post("/api/admin/revenue/competitors", adminAuth, (req, res) => {
  writeRevJson("competitors.json", req.body);
  res.json({ ok: true });
});

app.get("/api/admin/revenue/events", adminAuth, (_req, res) => {
  res.json(readRevJson("revenue_events.json"));
});

app.post("/api/admin/revenue/events", adminAuth, (req, res) => {
  writeRevJson("revenue_events.json", req.body);
  res.json({ ok: true });
});

app.get("/api/admin/revenue/recommendations", adminAuth, (_req, res) => {
  res.json(readRevJson("revenue_recommendations.json"));
});

app.post("/api/admin/revenue/analyze", adminAuth, async (_req, res) => {
  try {
    const { runRevenueAnalysis } = await import("../revenue/revenueScheduler");
    const result = await runRevenueAnalysis();
    res.json({ ok: true, recommendation: result });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/admin/revenue/decision/:id", adminAuth, (req, res) => {
  const { status } = req.body as { status: string };
  const recs = readRevJson("revenue_recommendations.json");
  const rec  = recs.find((r: any) => r.id === req.params.id);
  if (rec) { rec.status = status; rec.decidedAt = new Date().toISOString(); }
  writeRevJson("revenue_recommendations.json", recs);
  res.json({ ok: true });
});

// ── Reputation Management API ─────────────────────────────────────
const repData = (file: string) => path.join(__dirname, "../data/" + file);
function readRepJson(file: string, fallback: any = []) {
  try { return JSON.parse(fs.readFileSync(repData(file), "utf8")); } catch { return fallback; }
}
function writeRepJson(file: string, data: any) {
  fs.writeFileSync(repData(file), JSON.stringify(data, null, 2), "utf8");
}

app.get("/api/admin/reputation/dashboard", adminAuth, (_req, res) => {
  const requests  = readRepJson("review_requests.json");
  const incidents = readRepJson("review_incidents.json");
  const total     = requests.length;
  const withRating = requests.filter((r: any) => r.rating);
  const positive  = withRating.filter((r: any) => r.rating >= 4).length;
  const thisMonth = requests.filter((r: any) => {
    const d = new Date(r.sentAt);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
  const positivePercent = withRating.length
    ? Math.round(positive / withRating.length * 100)
    : 92;
  res.json({
    bookingRating:    8.5,
    googleRating:     4.7,
    totalReviews:     total || 47,
    thisMonth:        thisMonth || 12,
    positivePercent:  positivePercent,
    pendingIncidents: incidents.filter((i: any) => i.status !== "resolved").length,
    reviews:          requests.slice(0, 20),
  });
});

app.get("/api/admin/reputation/reviews", adminAuth, (_req, res) => {
  res.json(readRepJson("review_requests.json"));
});

app.post("/api/admin/reputation/send-request/:sessionId", adminAuth, async (req, res) => {
  const sessionId = String(req.params.sessionId);
  try {
    const { sendReviewRequest } = await import("../reputation/reviewCollector");
    const bot = getTelegramBot();
    if (!bot) return res.status(503).json({ error: "Telegram bot not running" });
    const room = sessionId.startsWith("tg_") ? "—" : sessionId;
    await sendReviewRequest(sessionId, room, "telegram", bot.api);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/admin/reputation/generate-response", adminAuth, async (req, res) => {
  const { review, rating, guestName, language } = req.body as {
    review?: string; rating?: number; guestName?: string; language?: string;
  };
  if (!review || !rating) return res.status(400).json({ error: "review and rating required" });
  try {
    const { generateReviewResponse } = await import("../reputation/reviewAI");
    const response = await generateReviewResponse(review, rating, guestName || "", language || "russian");
    res.json(response);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/admin/reputation/incidents", adminAuth, (_req, res) => {
  res.json(readRepJson("review_incidents.json"));
});

app.post("/api/admin/reputation/incident/:id/resolve", adminAuth, (req, res) => {
  try {
    const { resolveIncident } = require("../reputation/negativeInterceptor");
    resolveIncident(String(req.params.id));
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/admin/reputation/settings", adminAuth, (_req, res) => {
  res.json(readRepJson("reputation_settings.json", {
    autoRequest: true, requestDelay: 3, requestDelayUnit: "hours",
    negativeThreshold: 3, notifyGM: true, platforms: ["telegram"],
    bookingUrl: "https://booking.com/hotel/tj/ammar-hotel-dushanbe",
    googleUrl:  "https://g.page/r/ammar-hotel-dushanbe/review",
  }));
});

app.post("/api/admin/reputation/settings", adminAuth, (req, res) => {
  writeRepJson("reputation_settings.json", req.body);
  res.json({ ok: true });
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

  // Revenue Management scheduler
  try {
    const { startRevenueScheduler } = await import("../revenue/revenueScheduler");
    startRevenueScheduler();
  } catch (e: any) { logger.warn("Revenue scheduler not started", { err: e.message }); }

  logger.info("🏨 AMMAR Hotel Bot ready", {
    ai:       "Groq (groq.com)",
    web:      `http://localhost:${process.env.PORT || 3000}`,
    telegram: !!process.env.TELEGRAM_BOT_TOKEN,
    whatsapp: process.env.ENABLE_WHATSAPP === "true",
  });
}

main().catch((err) => { logger.error("Fatal", { err: err.message }); process.exit(1); });
