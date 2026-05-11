// src/reputation/negativeInterceptor.ts
import fs   from "fs";
import path from "path";
import { notifyStaff } from "../integrations/staffNotifier";
import { logger } from "../utils/logger";

export interface ReviewIncident {
  id:         string;
  guestId:    string;
  roomNumber: string;
  rating:     number;
  comment:    string;
  guestName:  string;
  createdAt:  string;
  status:     "pending" | "in_progress" | "resolved";
  resolvedAt?: string;
}

const DATA_PATH = () => path.join(process.cwd(), "src/data/review_incidents.json");

export function loadIncidents(): ReviewIncident[] {
  try { return JSON.parse(fs.readFileSync(DATA_PATH(), "utf8")); } catch { return []; }
}

function saveIncident(inc: ReviewIncident): void {
  let data = loadIncidents();
  data     = data.filter(i => i.id !== inc.id);
  data.unshift(inc);
  data = data.slice(0, 500);
  fs.writeFileSync(DATA_PATH(), JSON.stringify(data, null, 2));
}

export function resolveIncident(id: string): void {
  const data = loadIncidents();
  const idx  = data.findIndex(i => i.id === id);
  if (idx !== -1) {
    data[idx].status     = "resolved";
    data[idx].resolvedAt = new Date().toISOString();
    fs.writeFileSync(DATA_PATH(), JSON.stringify(data, null, 2));
  }
}

export async function interceptNegativeReview(
  guestId:    string,
  roomNumber: string,
  rating:     number,
  comment:    string,
  guestName:  string
): Promise<void> {
  if (rating > 3) return;

  logger.info(`🚨 Negative review intercepted: room ${roomNumber}, rating ${rating}`);

  const inc: ReviewIncident = {
    id:         `INC-${Date.now()}`,
    guestId,
    roomNumber,
    rating,
    comment:    comment || "Без комментария",
    guestName:  guestName || "Неизвестный гость",
    createdAt:  new Date().toISOString(),
    status:     "pending",
  };

  saveIncident(inc);

  await notifyStaff("gm", {
    type:    "🚨 НЕГАТИВНЫЙ ОТЗЫВ ПЕРЕХВАЧЕН",
    room:    roomNumber,
    rating:  `${rating}⭐ из 5`,
    guest:   guestName || "Неизвестный гость",
    comment: comment || "Без комментария",
    action:  "Требуется немедленный контакт с гостем",
  });
}
