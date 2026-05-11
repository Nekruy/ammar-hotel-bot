// src/reputation/reviewCollector.ts
import fs   from "fs";
import path from "path";
import { logger } from "../utils/logger";

export interface ReviewRequest {
  id:         string;
  guestId:    string;
  roomNumber: string;
  platform:   "telegram" | "whatsapp";
  sentAt:     string;
  status:     "sent" | "responded" | "positive" | "negative";
  rating?:    number;
  comment?:   string;
}

const DATA_PATH = () => path.join(process.cwd(), "src/data/review_requests.json");

export function loadReviewRequests(): ReviewRequest[] {
  try { return JSON.parse(fs.readFileSync(DATA_PATH(), "utf8")); } catch { return []; }
}

function saveReviewRequest(req: ReviewRequest): void {
  let data = loadReviewRequests();
  data = data.filter(r => r.id !== req.id);
  data.unshift(req);
  data = data.slice(0, 200);
  fs.writeFileSync(DATA_PATH(), JSON.stringify(data, null, 2));
}

export function updateReviewRequest(id: string, updates: Partial<ReviewRequest>): void {
  const data = loadReviewRequests();
  const idx  = data.findIndex(r => r.id === id);
  if (idx !== -1) {
    data[idx] = { ...data[idx], ...updates };
    fs.writeFileSync(DATA_PATH(), JSON.stringify(data, null, 2));
  }
}

export async function sendReviewRequest(
  guestId:    string,
  roomNumber: string,
  platform:   string,
  botApi:     any
): Promise<void> {
  const settings = loadReputationSettings();
  const template = settings.template?.ru ||
    "Спасибо что выбрали AMMAR Hotel! Оцените ваше пребывание:";

  const message =
    `🏨 Спасибо что выбрали AMMAR Hotel!\n\n` +
    `Как прошло ваше пребывание?\n\n` +
    `Оцените нас от 1 до 5 — просто отправьте цифру:\n` +
    `1⭐ 2⭐ 3⭐ 4⭐ 5⭐\n\n` +
    `Ваше мнение помогает нам стать лучше 🙏`;

  const req: ReviewRequest = {
    id:         `REV-${Date.now()}`,
    guestId,
    roomNumber,
    platform:   platform as any,
    sentAt:     new Date().toISOString(),
    status:     "sent",
  };

  if (platform === "telegram" && guestId.startsWith("tg_")) {
    const userId = guestId.replace("tg_", "");
    try {
      await botApi.sendMessage(userId, message);
      saveReviewRequest(req);
      logger.info(`📨 Review request sent to ${guestId} (room ${roomNumber})`);
    } catch (err: any) {
      logger.error(`❌ Failed to send review request: ${err.message}`);
    }
  }
}

// ── Settings ──────────────────────────────────────────────────────────────────
const SETTINGS_PATH = () => path.join(process.cwd(), "src/data/reputation_settings.json");

export interface ReputationSettings {
  autoRequest:       boolean;
  requestDelay:      number;
  requestDelayUnit:  string;
  negativeThreshold: number;
  notifyGM:          boolean;
  platforms:         string[];
  bookingUrl:        string;
  googleUrl:         string;
  template: {
    ru: string; tj: string; en: string; cn: string;
  };
}

export function loadReputationSettings(): ReputationSettings {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH(), "utf8"));
  } catch {
    return {
      autoRequest: true, requestDelay: 3, requestDelayUnit: "hours",
      negativeThreshold: 3, notifyGM: true, platforms: ["telegram"],
      bookingUrl: "https://booking.com/hotel/tj/ammar-hotel-dushanbe",
      googleUrl:  "https://g.page/r/ammar-hotel-dushanbe/review",
      template: {
        ru: "Спасибо что выбрали AMMAR Hotel! Оцените ваше пребывание...",
        tj: "Ташаккур барои интихоби AMMAR Hotel!...",
        en: "Thank you for choosing AMMAR Hotel!...",
        cn: "感谢您选择AMMAR Hotel！...",
      },
    };
  }
}

export function saveReputationSettings(settings: ReputationSettings): void {
  fs.writeFileSync(SETTINGS_PATH(), JSON.stringify(settings, null, 2));
}
