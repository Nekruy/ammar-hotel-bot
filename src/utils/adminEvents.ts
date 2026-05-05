// src/utils/adminEvents.ts — SSE broadcaster для админ-панели

import type { Response } from "express";

const clients = new Set<Response>();

export function addSSEClient(res: Response):    void { clients.add(res);    }
export function removeSSEClient(res: Response): void { clients.delete(res); }
export function sseClientCount():            number { return clients.size;  }

export function broadcastEvent(event: string, data: unknown): void {
  if (clients.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(payload); }
    catch { clients.delete(res); }
  }
}
