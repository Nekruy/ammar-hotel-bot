// src/integrations/pmsClient.ts — Ammar PMS public API wrapper

import axios, { AxiosError } from "axios";
import { logger } from "../utils/logger";

const BASE = (process.env.PMS_API_URL ?? "http://localhost:3000").replace(/\/$/, "");

const http = axios.create({ baseURL: BASE, timeout: 8000 });

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

export interface AvailabilityResult {
  roomTypeId:  string;
  name:        string;
  description: string;
  capacity:    number;
  available:   number;
  nights:      number;
  ratePlans: {
    id:               string;
    name:             string;
    includesBreakfast: boolean;
    refundable:       boolean;
    pricePerNight:    number;
    totalPrice:       number;
  }[];
}

export interface CreateBookingInput {
  checkIn:    string;
  checkOut:   string;
  roomTypeId: string;
  ratePlanId: string;
  fullName:   string;
  phone?:     string;
  email?:     string;
  adults?:    number;
  language?:  string;
}

function apiErr(e: unknown): string {
  if (e instanceof AxiosError) {
    const msg = e.response?.data?.message ?? e.message;
    return Array.isArray(msg) ? msg.join("; ") : String(msg);
  }
  return String(e);
}

export const pmsClient = {

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

  async getAvailability(checkIn: string, checkOut: string, guests: number): Promise<AvailabilityResult[]> {
    try {
      const { data } = await http.get<AvailabilityResult[]>("/api/public/availability", {
        params: { checkIn, checkOut, guests, locale: "ru" },
      });
      return data;
    } catch (e) {
      logger.warn("pmsClient.getAvailability failed", { checkIn, checkOut, guests, err: apiErr(e) });
      return [];
    }
  },

  async createBooking(input: CreateBookingInput): Promise<{ code: string; status: string } | null> {
    try {
      const { data } = await http.post<{ code: string; status: string }>("/api/public/bookings", input);
      return data;
    } catch (e) {
      logger.warn("pmsClient.createBooking failed", { input, err: apiErr(e) });
      return null;
    }
  },
};
