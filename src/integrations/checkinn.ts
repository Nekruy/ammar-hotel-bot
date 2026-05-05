// src/integrations/checkinn.ts
// CheckInn PMS API — заглушка (готово к подключению)
// Включить: CHECKINN_ENABLED=true в .env

import axios from "axios";
import { logger } from "../utils/logger";

const BASE = process.env.CHECKINN_API_URL;
const KEY  = process.env.CHECKINN_API_KEY;
const headers = { "Authorization": `Bearer ${KEY}`, "Content-Type": "application/json" };

export const checkinn = {

  // Получить бронирование по номеру комнаты
  async getBooking(room: string) {
    if (process.env.CHECKINN_ENABLED !== "true") return mockBooking(room);
    try {
      const { data } = await axios.get(`${BASE}/bookings/room/${room}`, { headers });
      return data;
    } catch {
      logger.warn("CheckInn getBooking failed, using mock");
      return mockBooking(room);
    }
  },

  // Создать заказ room service
  async createOrder(payload: any) {
    if (process.env.CHECKINN_ENABLED !== "true") return { id: `mock-${Date.now()}` };
    const { data } = await axios.post(`${BASE}/orders`, payload, { headers });
    return data;
  },

  // Создать задачу хаускипинга
  async createTask(payload: any) {
    if (process.env.CHECKINN_ENABLED !== "true") return { id: `mock-${Date.now()}` };
    const { data } = await axios.post(`${BASE}/housekeeping/tasks`, payload, { headers });
    return data;
  },
};

// Мок-данные для разработки
function mockBooking(room: string) {
  return {
    found:              true,
    room_number:        room,
    guest_name:         "Гость AMMAR",
    room_type:          "Standard Double",
    check_in:           "2026-04-20",
    check_out:          "2026-04-25",
    nights:             5,
    breakfast_included: true,
    status:             "active",
    _note:              "CheckInn mock — включить: CHECKINN_ENABLED=true",
  };
}
