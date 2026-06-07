// src/utils/redis.ts — Sessions and conversation history via Redis (ioredis)

import Redis from "ioredis";
import { logger } from "./logger";

export interface Session {
  guestId:        string;
  roomNumber?:    string;
  guestName?:     string;
  language:       "tajik" | "russian" | "english" | "chinese";
  platform:       "telegram" | "whatsapp" | "web";
  checkIn?:       string;
  checkOut?:      string;
  createdAt:      string;
  awaitingReview?: boolean;
}

export interface Message {
  role:    "user" | "assistant";
  content: string;
  time?:   string;
}

const SESSION_TTL = 86400; // 24 hours
const HISTORY_MAX = 20;    // last 20 messages (10 Q&A pairs)

let _redis: Redis | null = null;

function getRedis(): Redis {
  if (!_redis) {
    if (!process.env.REDIS_URL) throw new Error("REDIS_URL is not set");
    _redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 3 });
    _redis.on("error", (err) => logger.error("Redis error", { msg: err.message }));
  }
  return _redis;
}

const sk = (key: string) => `bot:session:${key}`;
const hk = (key: string) => `bot:history:${key}`;

export async function getSession(key: string): Promise<Session | null> {
  const raw = await getRedis().get(sk(key));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function setSession(key: string, data: Session): Promise<void> {
  await getRedis().setex(sk(key), SESSION_TTL, JSON.stringify(data));
}

export async function updateSession(key: string, patch: Partial<Session>): Promise<void> {
  const cur = await getSession(key);
  if (cur) await setSession(key, { ...cur, ...patch });
}

export async function getHistory(key: string): Promise<Message[]> {
  const raw = await getRedis().get(hk(key));
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

export async function setHistory(key: string, history: Message[]): Promise<void> {
  await getRedis().setex(hk(key), SESSION_TTL, JSON.stringify(history.slice(-HISTORY_MAX)));
}

export async function clearHistory(key: string): Promise<void> {
  await getRedis().del(hk(key));
}

// ── Admin panel support ──────────────────────────────────────────

export interface GuestEntry {
  key:         string;
  session:     Session;
  msgCount:    number;
  lastMessage?: string;
  lastTime?:   string;
  isOnline:    boolean;
}

export async function getAllSessions(): Promise<GuestEntry[]> {
  const r = getRedis();
  const keys = await r.keys("bot:session:*");
  const now = Date.now();
  const ONLINE_THRESHOLD = 5 * 60 * 1000;

  const entries: GuestEntry[] = [];

  for (const key of keys) {
    const guestKey = key.replace("bot:session:", "");
    const [rawSession, rawHistory] = await Promise.all([
      r.get(key),
      r.get(hk(guestKey)),
    ]);
    if (!rawSession) continue;

    let session: Session;
    try { session = JSON.parse(rawSession); } catch { continue; }

    let history: Message[] = [];
    try { if (rawHistory) history = JSON.parse(rawHistory); } catch {}

    const lastUserMsg = [...history].reverse().find(m => m.role === "user");
    const lastTime = lastUserMsg?.time;
    const isOnline = lastTime
      ? now - new Date(lastTime).getTime() < ONLINE_THRESHOLD
      : false;

    entries.push({
      key: guestKey,
      session,
      msgCount:    history.length,
      lastMessage: lastUserMsg?.content?.slice(0, 80),
      lastTime,
      isOnline,
    });
  }

  return entries;
}

export async function getHistoryByKey(key: string): Promise<Message[]> {
  return getHistory(key);
}
