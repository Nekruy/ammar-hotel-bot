// src/tools/executor.ts — 14 инструментов

import { GuestCtx }    from "../ai/grokService";
import { notifyStaff } from "../integrations/staffNotifier";
import { checkinn }    from "../integrations/checkinn";
import { logger }      from "../utils/logger";
import { prisma }      from "../utils/db";
import cityGuide       from "../data/city_guide.json";
import { incRoomService, incEscalations } from "../utils/stats";

export async function executeToolCall(
  name:  string,
  input: Record<string, any>,
  guest: GuestCtx
): Promise<any> {
  const room = input.room_number || guest.roomNumber || "N/A";
  try {
    switch (name) {
      case "get_booking":            return await toolGetBooking(room, guest);
      case "create_room_service":    return await toolRoomService(room, input, guest);
      case "create_housekeeping":    return await toolHousekeeping(room, input, guest);
      case "arrange_taxi":           return await toolTaxi(room, input);
      case "get_city_info":          return await toolCityInfo(input);
      case "get_exchange_rate":      return await toolExchange(input.currency);
      case "escalate_to_staff":      return await toolEscalate(room, input, guest);
      case "create_upsell":          return await toolUpsell(room, input, guest);
      case "get_restaurant_menu":    return await toolMenu(input.meal_time);
      case "request_wake_up":        return await toolWakeUp(room, input);
      case "arrange_excursion":      return await toolExcursion(room, input);
      case "get_weather":            return await toolWeather(Number(input.days) || 1);
      case "request_late_checkout":  return await toolLateCheckout(room, input);
      case "request_room_extension": return await toolRoomExtension(room, input);
      case "escalate_to_human":      return await toolEscalateToHuman(room, input, guest);
      default: return { error: `Unknown tool: ${name}` };
    }
  } catch (e: any) {
    logger.error(`Tool ${name} error`, { msg: e.message, room });
    return { error: "Ошибка. Попробуйте ещё раз или обратитесь на ресепшн: 0" };
  }
}

// ════════ 1. БРОНИРОВАНИЕ ════════════════════════════════════════
async function toolGetBooking(room: string, _g: GuestCtx) {
  return await checkinn.getBooking(room);
}

// ════════ 2. ROOM SERVICE ════════════════════════════════════════
async function toolRoomService(room: string, input: any, guest: GuestCtx) {
  const id    = `RS-${Date.now()}`;
  const items = (input.items as any[])
    .map(i => `${i.quantity}× ${i.name}${i.notes ? ` (${i.notes})` : ""}`)
    .join(", ");

  await safePrisma(() => prisma.order.create({
    data: { id, guestId: guest.guestId, roomNumber: room, items: input.items, status: "PENDING" }
  }));

  await notifyStaff("kitchen", { room, orderId: id, items, time: input.delivery_time || "СЕЙЧАС" });
  incRoomService();

  return { success: true, order_id: id, room, items, eta: "15–25 минут", status: "Передано на кухню ✅" };
}

// ════════ 3. ХАУСКИПИНГ ══════════════════════════════════════════
async function toolHousekeeping(room: string, input: any, guest: GuestCtx) {
  const id = `HK-${Date.now()}`;
  const label: Record<string, string> = {
    cleaning:  "🧹 Уборка", towels:    "🛁 Полотенца", pillows:   "😴 Подушки",
    slippers:  "🩴 Тапочки", iron:      "👔 Утюг",      hairdryer: "💇 Фен",
    minibar:   "🥤 Минибар", other:     "📋 Другое",
  };

  await safePrisma(() => prisma.task.create({
    data: { id, guestId: guest.guestId, roomNumber: room,
            taskType: input.task_type, description: input.description || "",
            priority: (input.priority || "normal").toUpperCase(), status: "PENDING" }
  }));

  await notifyStaff("housekeeping", {
    type:     label[input.task_type] || input.task_type,
    taskId:   id,
    room,
    priority: input.priority === "urgent" ? "⚡ СРОЧНО" : "обычный",
    note:     input.description || "",
  });

  return {
    success: true, task_id: id, room,
    task:    label[input.task_type],
    eta:     input.priority === "urgent" ? "5–10 мин" : "15–20 мин",
  };
}

// ════════ 4. ТАКСИ ═══════════════════════════════════════════════
async function toolTaxi(room: string, input: any) {
  const id = `TX-${Date.now()}`;
  const prices: Record<string, string> = {
    standard: "25–40 сом", comfort: "50–70 сом", airport_transfer: "80–120 сом",
  };

  await notifyStaff("reception", {
    type:        "🚕 ЗАКАЗ ТАКСИ",
    bookingId:   id,
    room,
    destination: input.destination,
    time:        input.pickup_time,
    passengers:  input.passengers || 1,
    taxi_type:   input.taxi_type || "standard",
  });

  return {
    success:      true,
    booking_id:   id,
    destination:  input.destination,
    pickup_time:  input.pickup_time,
    price:        prices[input.taxi_type || "standard"],
    note:         "Водитель у главного входа ✅",
  };
}

// ════════ 5. ГИД ПО ГОРОДУ (из city_guide.json) ══════════════════
async function toolCityInfo(input: any) {
  const guide = cityGuide as Record<string, any[]>;
  const results = guide[input.category] ?? [];
  return {
    category: input.category,
    results,
    total:    results.length,
    note:     "Уточняйте часы работы — они могут меняться",
    source:   "city_guide.json (локальная база AMMAR)",
  };
}

// ════════ 6. КУРС ВАЛЮТ (реальный fetch → фолбэк) ════════════════
async function toolExchange(currency: string) {
  const CUR = currency.toLowerCase();

  try {
    const res = await fetch(
      `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/tjs.json`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { date: string; tjs: Record<string, number> };

    // data.tjs[cur] = сколько единиц иностр. валюты в 1 сомони
    // нам нужно: сколько сомони за 1 ед. иностр. валюты = 1 / data.tjs[cur]
    const rateTjs = data.tjs[CUR] ? parseFloat((1 / data.tjs[CUR]).toFixed(2)) : 0;

    if (!rateTjs) throw new Error(`Currency ${currency} not found`);

    logger.info(`Exchange rate fetched: 1 ${currency} = ${rateTjs} TJS`, { source: "cdn.jsdelivr.net/fawazahmed0" });

    return {
      currency,
      rate_tjs: rateTjs,
      example:  `100 ${currency} = ${(rateTjs * 100).toFixed(0)} сомони`,
      date:     data.date,
      source:   "Актуальный курс (fawazahmed0/currency-api)",
    };
  } catch (err: any) {
    logger.warn(`Exchange rate fetch failed (${err.message}), using fallback`);
    const fallback: Record<string, number> = { USD: 10.92, EUR: 11.85, RUB: 0.12, CNY: 1.51, GBP: 14.20 };
    const r = fallback[currency] ?? 0;
    return {
      currency,
      rate_tjs: r,
      example:  `100 ${currency} = ${(r * 100).toFixed(0)} сомони`,
      date:     "cached",
      source:   "Кэш (актуализируйте при стабильном интернете)",
    };
  }
}

// ════════ 7. ЭСКАЛАЦИЯ ═══════════════════════════════════════════
async function toolEscalate(room: string, input: any, guest: GuestCtx) {
  const id = `ESC-${Date.now()}`;
  const ch: "emergency" | "reception" = input.priority === "emergency" ? "emergency" : "reception";

  await notifyStaff(ch, {
    type:    `🚨 ${input.priority.toUpperCase()}`,
    escId:   id,
    room,
    reason:  input.reason,
    summary: input.summary || input.reason,
    guest:   guest.guestName || "Гость",
  });
  await notifyStaff("gm", {
    type:   `⚠️ Эскалация [${input.priority}] Комната ${room}`,
    escId:  id,
    reason: input.reason,
  });

  await safePrisma(() => prisma.eventLog.create({ data: { eventType: "ESCALATION", roomNumber: room, data: input } }));
  incEscalations();

  return {
    success: true,
    esc_id:  id,
    status:  "Передано персоналу",
    eta:     input.priority === "emergency" ? "НЕМЕДЛЕННО" : input.priority === "urgent" ? "5 мин" : "15 мин",
  };
}

// ════════ 8. UPSELL (без spa и room_upgrade) ═════════════════════
async function toolUpsell(room: string, input: any, _g: GuestCtx) {
  const offers: Record<string, any> = {
    restaurant: { title: "🍽 Ужин в AMMAR",     desc: "Авторская таджикская кухня", action: "Бронь: тел. 0 | 18:00–23:00" },
    breakfast:  { title: "☕ Завтрак в номер",  desc: "07:00–10:30",                action: "Напишите мне что заказать!" },
    excursion:  { title: "🏔 Экскурсия",         desc: "Ромит, Такоб, Варзоб — 4–6ч", action: "Организуем через консьерж" },
  };

  await safePrisma(() => prisma.eventLog.create({ data: { eventType: "UPSELL", roomNumber: room, data: { offer: input.offer_type } } }));

  return { success: true, offer: offers[input.offer_type] };
}

// ════════ 9. МЕНЮ ════════════════════════════════════════════════
async function toolMenu(mealTime = "all") {
  const menus: Record<string, any[]> = {
    breakfast: [
      { name: "Яичница с овощами", price: "20 сом" },
      { name: "Каша овсяная",      price: "15 сом" },
      { name: "Круассан с маслом", price: "18 сом" },
      { name: "Фруктовая тарелка", price: "25 сом" },
    ],
    lunch: [
      { name: "Плов таджикский",  price: "45 сом" },
      { name: "Лагман",           price: "40 сом" },
      { name: "Шашлык (3 шп.)",   price: "55 сом" },
      { name: "Салат свежий",     price: "25 сом" },
      { name: "Сэндвич с курицей",price: "35 сом" },
    ],
    dinner: [
      { name: "Плов таджикский",  price: "45 сом" },
      { name: "Лагман",           price: "40 сом" },
      { name: "Шашлык (3 шп.)",   price: "55 сом" },
      { name: "Салат свежий",     price: "25 сом" },
      { name: "Сэндвич с курицей",price: "35 сом" },
    ],
    drinks: [
      { name: "Чай зел./чёрн.",   price: "10 сом" },
      { name: "Кофе эспрессо",    price: "15 сом" },
      { name: "Сок свежий",       price: "20 сом" },
      { name: "Вода минеральная", price: "8 сом"  },
    ],
  };
  if (mealTime === "all") return { menu: menus, hours: "07:00–23:00", location: "1 этаж", currency: "сом (сомони)" };
  return {
    meal:     mealTime,
    items:    menus[mealTime] ?? [],
    hours:    mealTime === "breakfast" ? "07:00–10:30" : "11:00–23:00",
    currency: "сом (сомони)",
  };
}

// ════════ 10. ПОБУДКА ════════════════════════════════════════════
async function toolWakeUp(room: string, input: any) {
  const id   = `WU-${Date.now()}`;
  const date = input.date || new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  await notifyStaff("reception", { type: "⏰ ПОБУДКА", wakeId: id, room, time: `${input.wake_time} (${date})` });

  return { success: true, wake_id: id, room, time: `${input.wake_time}, ${date}`, note: "Ресепшн позвонит ✅" };
}

// ════════ 11. ЭКСКУРСИИ ══════════════════════════════════════════
async function toolExcursion(room: string, input: any) {
  const exc: Record<string, any> = {
    Romit:       { name: "Ромитское ущелье",    dur: "4–5 ч",      km: 40  },
    Takob:       { name: "Такоб",               dur: "5–6 ч",      km: 60  },
    Iskanderkul: { name: "Искандеркуль",         dur: "полн. день", km: 180 },
    Penjikent:   { name: "Пенджикент",           dur: "полн. день", km: 250 },
    Hissar:      { name: "Гиссарская крепость",  dur: "3–4 ч",      km: 30  },
    city_tour:   { name: "Тур по Душанбе",       dur: "3–4 ч",      km: "city" },
  };
  const e = exc[input.destination] ?? { name: input.destination };

  await notifyStaff("reception", {
    type:         "🏔 ЭКСКУРСИЯ",
    room,
    excursion:    e.name,
    date:         input.date || "уточнить",
    participants: input.participants || 1,
  });

  return { success: true, excursion: e, date: input.date || "уточните дату", note: "Гид свяжется с вами ✅" };
}

// ════════ 12. ПОГОДА (реальный fetch wttr.in → фолбэк) ═══════════
async function toolWeather(days: number) {
  try {
    const res = await fetch(
      "https://wttr.in/Dushanbe?format=j1",
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as any;

    const cur = data.current_condition[0];
    const condMap: Record<string, string> = {
      "Sunny": "Солнечно ☀️", "Clear": "Ясно ☀️",
      "Partly cloudy": "Переменная облачность ⛅", "Cloudy": "Облачно ☁️",
      "Overcast": "Пасмурно ☁️", "Rain": "Дождь 🌧", "Light rain": "Лёгкий дождь 🌦",
      "Snow": "Снег ❄️", "Fog": "Туман 🌫", "Thunder": "Гроза ⛈",
    };
    const desc  = cur.weatherDesc[0]?.value ?? "Ясно";
    const cond  = condMap[desc] ?? desc;

    const forecast = (data.weather as any[]).slice(0, Math.min(days, 5)).map((w, i) => ({
      day:       i === 0 ? "Сегодня" : i === 1 ? "Завтра" : `День ${i + 1}`,
      max:       parseInt(w.maxtempC),
      min:       parseInt(w.mintempC),
      condition: condMap[w.hourly?.[4]?.weatherDesc?.[0]?.value ?? ""] ?? cond,
    }));

    logger.info("Weather fetched from wttr.in");

    return {
      city:    "Душанбе",
      current: {
        temp:      parseInt(cur.temp_C),
        feels_like: parseInt(cur.FeelsLikeC),
        condition: cond,
        humidity:  parseInt(cur.humidity),
        wind_kmh:  parseInt(cur.windspeedKmph),
      },
      forecast,
      source: "wttr.in (актуально)",
    };
  } catch (err: any) {
    logger.warn(`Weather fetch failed (${err.message}), using fallback`);
    return {
      city:    "Душанбе",
      current: { temp: 22, feels_like: 20, condition: "Ясно ☀️", humidity: 35, wind_kmh: 8 },
      forecast: Array.from({ length: Math.min(days, 5) }, (_, i) => ({
        day:       i === 0 ? "Сегодня" : i === 1 ? "Завтра" : `День ${i + 1}`,
        max:       24 + i, min: 12 + i,
        condition: i % 2 === 0 ? "Ясно ☀️" : "Переменная облачность ⛅",
      })),
      source: "Кэш (нет доступа к wttr.in)",
    };
  }
}

// ════════ 13. ПОЗДНИЙ ВЫЕЗД ══════════════════════════════════════
async function toolLateCheckout(room: string, input: any) {
  const id = `LC-${Date.now()}`;

  await notifyStaff("late_checkout", {
    room,
    requestId:     id,
    checkout_time: input.checkout_time,
  });

  await safePrisma(() => prisma.eventLog.create({
    data: { eventType: "LATE_CHECKOUT", roomNumber: room, data: { checkout_time: input.checkout_time } }
  }));

  return {
    success:       true,
    request_id:    id,
    room,
    checkout_time: input.checkout_time,
    status:        "Запрос отправлен персоналу",
    note:          "Администратор подтвердит в течение 5–10 минут ✅",
  };
}

// ════════ 14. ПРОДЛЕНИЕ НОМЕРА ════════════════════════════════════
async function toolRoomExtension(room: string, input: any) {
  const id = `RE-${Date.now()}`;

  await notifyStaff("room_extension", {
    room,
    requestId:         id,
    extra_nights:      input.extra_nights,
    new_checkout_date: input.new_checkout_date || "уточнить",
  });

  await safePrisma(() => prisma.eventLog.create({
    data: { eventType: "ROOM_EXTENSION", roomNumber: room, data: input }
  }));

  return {
    success:           true,
    request_id:        id,
    room,
    extra_nights:      input.extra_nights,
    new_checkout_date: input.new_checkout_date,
    status:            "Запрос на продление отправлен",
    note:              "Администратор свяжется с вами в течение 5–10 минут для подтверждения и расчёта стоимости ✅",
  };
}

// ════════ 15. ЭСКАЛАЦИЯ К ЖИВОМУ АДМИНИСТРАТОРУ ══════════════════
async function toolEscalateToHuman(room: string, input: any, guest: GuestCtx) {
  const id = `HE-${Date.now()}`;

  await notifyStaff("human_escalation", {
    room,
    requestId:     id,
    reason:        input.reason,
    guest_message: input.guest_message || "—",
    priority:      input.priority || "normal",
    guest:         guest.guestName || "Гость",
    platform:      guest.platform,
  });

  await safePrisma(() => prisma.eventLog.create({
    data: { eventType: "HUMAN_ESCALATION", roomNumber: room, data: input }
  }));

  return {
    success:    true,
    request_id: id,
    status:     "Администратор уведомлён",
    eta:        input.priority === "urgent" ? "2–3 минуты" : "5–10 минут",
  };
}

// ── Безопасный вызов Prisma (если БД не подключена — не ломает) ──
async function safePrisma<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}
