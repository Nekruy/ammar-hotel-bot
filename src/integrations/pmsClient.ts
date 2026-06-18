// src/integrations/pmsClient.ts — Ammar PMS API wrapper (public + bot endpoints)

import axios, { AxiosError } from "axios";
import { logger } from "../utils/logger";

const BASE = (process.env.PMS_API_URL ?? "http://localhost:3000").replace(/\/$/, "");

// Public endpoints — no auth
const http = axios.create({ baseURL: BASE, timeout: 8000 });

// Bot endpoints — x-bot-api-key
const BOT_KEY = process.env.BOT_API_KEY ?? "";
const botHttp  = axios.create({
  baseURL: BASE,
  timeout: 8000,
  headers: BOT_KEY ? { "x-bot-api-key": BOT_KEY } : {},
});

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface BookingInfo {
  code:       string;
  status:     string;
  checkIn:    string;
  checkOut:   string;
  adults:     number;
  guestName:  string;
  roomType:   string;
  ratePlan:   string;
  totalPrice: number;
  source:     string;
  createdAt:  string;
}

export interface ReservationInfo {
  id:         string;
  folioId:    string;
  guestName:  string;
  checkIn:    string;
  checkOut:   string;
  roomType:   string;
  roomNumber: string;
  status:     string;
}

export interface FolioItem {
  id:           string;
  type:         string;
  description:  string;
  amount:       number;
  businessDate: string;
}

export interface FolioData {
  id:            string;
  reservationId: string;
  items:         FolioItem[];
  totalCharges:  number;
  totalPaid:     number;
  balance:       number;
}

export interface AddFolioItemInput {
  type:         "ROOM_CHARGE" | "MINIBAR" | "BREAKFAST" | "SERVICE" | "PENALTY" | "CORRECTION";
  description:  string;
  amount:       number;
  businessDate: string;
}

export interface ServiceItem {
  id:       string;
  name:     string;
  price:    number;
  category: "FOOD" | "TRANSPORT" | "MINIBAR" | "OTHER";
}

export interface I18nText {
  ru: string; en: string; tg: string; zh: string;
}

export interface KnowledgeMenuItem {
  id:        string;
  category:  string;
  nameRu:    string;
  nameEn:    string;
  nameTg:    string;
  nameZh:    string;
  descRu:    string;
  price:     number;
  available: boolean;
  sortOrder: number;
}

export interface KnowledgeData {
  restaurantOpen:       boolean;
  restaurantHours:      I18nText;
  breakfastIncluded:    boolean;
  breakfastHours:       I18nText;
  breakfastType:        I18nText;
  transferAvailable:    boolean;
  transferInfo:         I18nText;
  parkingAvailable:     boolean;
  parkingInfo:          I18nText;
  roomServiceAvailable: boolean;
  roomServiceHours:     I18nText;
  laundryAvailable:     boolean;
  spaAvailable:         boolean;
  spaInfo:              I18nText;
  conferenceAvailable:  boolean;
  wifiAvailable:        boolean;
  wifiInfo:             I18nText;
  currencyExchange:     boolean;
  checkInTime:          string;
  checkOutTime:         string;
  childrenPolicy:       I18nText;
  petsAllowed:          boolean;
  paymentInfo:          I18nText;
  cancellationPolicy:   I18nText;
  menu:                 KnowledgeMenuItem[];
}

// ── Error helper ──────────────────────────────────────────────────────────────

function apiErr(e: unknown): string {
  if (e instanceof AxiosError) {
    const msg = e.response?.data?.message ?? e.message;
    return Array.isArray(msg) ? msg.join("; ") : String(msg);
  }
  return String(e);
}

// ── 60-second knowledge cache ─────────────────────────────────────────────────

let _knowledgeCache: { data: KnowledgeData; ts: number } | null = null;
const KNOWLEDGE_TTL = 60_000;

// ── PMS client ─────────────────────────────────────────────────────────────────

export const pmsClient = {

  // ── Public endpoints (no auth) ─────────────────────────────────────────────

  async getBookingByCode(code: string): Promise<BookingInfo | null> {
    try {
      const { data } = await http.get<BookingInfo>(`/api/public/bookings/${encodeURIComponent(code.toUpperCase())}`);
      return data;
    } catch (e) {
      if (e instanceof AxiosError && e.response?.status === 404) return null;
      logger.warn("pmsClient.getBookingByCode failed", { code, err: apiErr(e) });
      return null;
    }
  },

  async getActiveBookingByRoom(roomNumber: string): Promise<BookingInfo | null> {
    try {
      const { data } = await http.get<BookingInfo>(`/api/public/bookings/active/${encodeURIComponent(roomNumber)}`);
      return data;
    } catch (e) {
      if (e instanceof AxiosError && e.response?.status === 404) return null;
      logger.warn("pmsClient.getActiveBookingByRoom failed", { roomNumber, err: apiErr(e) });
      return null;
    }
  },

  // ── Bot endpoints (x-bot-api-key) ──────────────────────────────────────────

  async getActiveReservationByRoom(roomNumber: string): Promise<ReservationInfo | null> {
    try {
      const { data } = await botHttp.get<ReservationInfo>(
        `/api/bot/reservations/active/${encodeURIComponent(roomNumber)}`
      );
      return data;
    } catch (e) {
      if (e instanceof AxiosError && e.response?.status === 404) return null;
      logger.warn("pmsClient.getActiveReservationByRoom failed", { roomNumber, err: apiErr(e) });
      return null;
    }
  },

  async getReservationFolio(reservationId: string): Promise<FolioData | null> {
    try {
      const { data } = await botHttp.get<FolioData>(
        `/api/bot/folios/${encodeURIComponent(reservationId)}`
      );
      return data;
    } catch (e) {
      if (e instanceof AxiosError && e.response?.status === 404) return null;
      logger.warn("pmsClient.getReservationFolio failed", { reservationId, err: apiErr(e) });
      return null;
    }
  },

  async addFolioItem(reservationId: string, item: AddFolioItemInput): Promise<boolean> {
    try {
      await botHttp.post(
        `/api/bot/reservations/${encodeURIComponent(reservationId)}/folio-items`,
        item
      );
      return true;
    } catch (e) {
      logger.warn("pmsClient.addFolioItem failed", { reservationId, err: apiErr(e) });
      return false;
    }
  },

  async getServices(category?: string): Promise<ServiceItem[]> {
    try {
      const params = category ? `?category=${encodeURIComponent(category)}` : "";
      const { data } = await botHttp.get<ServiceItem[]>(`/api/bot/services${params}`);
      return data;
    } catch (e) {
      logger.warn("pmsClient.getServices failed", { category, err: apiErr(e) });
      return [];
    }
  },

  async chargeService(
    reservationId: string,
    serviceId: string,
    qty: number,
    businessDate?: string,
  ): Promise<{ success: boolean; item?: any; error?: string }> {
    try {
      const { data } = await botHttp.post(
        `/api/bot/reservations/${encodeURIComponent(reservationId)}/charge-service`,
        { serviceId, qty, ...(businessDate ? { businessDate } : {}) },
      );
      return { success: true, item: data };
    } catch (e) {
      const msg = apiErr(e);
      logger.warn("pmsClient.chargeService failed", { reservationId, serviceId, err: msg });
      return { success: false, error: msg };
    }
  },

  async getKnowledge(): Promise<KnowledgeData | null> {
    if (_knowledgeCache && Date.now() - _knowledgeCache.ts < KNOWLEDGE_TTL) {
      return _knowledgeCache.data;
    }
    try {
      const { data } = await botHttp.get<KnowledgeData>("/api/bot/knowledge");
      _knowledgeCache = { data, ts: Date.now() };
      return data;
    } catch (e) {
      logger.warn("pmsClient.getKnowledge failed", { err: apiErr(e) });
      return null;
    }
  },
};
