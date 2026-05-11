// src/utils/redis.ts — Сессии и история в памяти (без Redis для быстрого старта)

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
  time?:   string; // ISO timestamp — заполняется с новыми сообщениями
}

// In-memory хранилище
const sessions  = new Map<string, Session>();
const histories = new Map<string, Message[]>();

export async function getSession(key: string): Promise<Session | null> {
  return sessions.get(key) ?? null;
}

export async function setSession(key: string, data: Session): Promise<void> {
  sessions.set(key, data);
}

export async function updateSession(key: string, patch: Partial<Session>): Promise<void> {
  const cur = sessions.get(key);
  if (cur) sessions.set(key, { ...cur, ...patch });
}

export async function getHistory(key: string): Promise<Message[]> {
  return histories.get(key) ?? [];
}

// Memory Buffer: хранит последние 20 сообщений (10 пар вопрос-ответ)
export async function setHistory(key: string, history: Message[]): Promise<void> {
  histories.set(key, history.slice(-20));
}

export async function clearHistory(key: string): Promise<void> {
  histories.delete(key);
}

// ── Для админ-панели ────────────────────────────────────────────────

export interface GuestEntry {
  key:         string;
  session:     Session;
  msgCount:    number;
  lastMessage?: string;
  lastTime?:   string;
  isOnline:    boolean;
}

export function getAllSessions(): GuestEntry[] {
  const now = Date.now();
  const ONLINE_THRESHOLD = 5 * 60 * 1000; // 5 минут

  return Array.from(sessions.entries()).map(([key, session]) => {
    const history = histories.get(key) ?? [];
    const lastUserMsg = [...history].reverse().find(m => m.role === "user");
    const lastTime = lastUserMsg?.time;
    const isOnline = lastTime
      ? now - new Date(lastTime).getTime() < ONLINE_THRESHOLD
      : false;

    return {
      key,
      session,
      msgCount:    history.length,
      lastMessage: lastUserMsg?.content?.slice(0, 80),
      lastTime,
      isOnline,
    };
  });
}

export function getHistoryByKey(key: string): Message[] {
  return histories.get(key) ?? [];
}
