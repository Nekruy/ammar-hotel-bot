// src/utils/db.ts — заглушка БД (работает без PostgreSQL)
export const prisma = {
  order:    { create: async (d: any) => d },
  task:     { create: async (d: any) => d },
  eventLog: { create: async (d: any) => d },
  guest:    { findUnique: async () => null, create: async (d: any) => d, update: async (d: any) => d },
  session:  { findFirst: async () => null, upsert: async (d: any) => d },
};
