// src/utils/stats.ts — суточная статистика (in-memory singleton)

interface DayStats {
  date:              string;
  totalMessages:     number;
  roomServiceOrders: number;
  escalations:       number;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

const data: DayStats = { date: todayKey(), totalMessages: 0, roomServiceOrders: 0, escalations: 0 };

function resetIfNewDay(): void {
  const today = todayKey();
  if (data.date !== today) {
    data.date = today; data.totalMessages = 0; data.roomServiceOrders = 0; data.escalations = 0;
  }
}

export function incMessages():    void { resetIfNewDay(); data.totalMessages++;     }
export function incRoomService(): void { resetIfNewDay(); data.roomServiceOrders++; }
export function incEscalations(): void { resetIfNewDay(); data.escalations++;       }
export function getStats(): DayStats   { resetIfNewDay(); return { ...data };       }
