// src/ai/grokService.ts
// AI движок — Groq (groq.com), совместим с OpenAI SDK

import fs   from "fs";
import path from "path";
import OpenAI from "openai";
import { getSystemPrompt } from "../utils/promptStore";
import { TOOLS }         from "../config/tools";
import { executeToolCall } from "../tools/executor";
import { logger }        from "../utils/logger";
import { Message }       from "../utils/redis";
import { broadcastEvent } from "../utils/adminEvents";
import { incMessages }   from "../utils/stats";

// ── Scenarios dataset (читаем с диска при каждом вызове — мгновенный эффект после правок) ──
// process.cwd() = project root (надёжнее __dirname в динамически импортируемых модулях tsx)
const SCENARIOS_PATH = path.join(process.cwd(), "src/data/scenarios.json");
const LANG_KEY: Record<string, string> = {
  russian: "ru", tajik: "tj", english: "en", chinese: "cn",
};

function findScenario(message: string, language: string): { id: string; response: string } | null {
  try {
    const raw = fs.readFileSync(SCENARIOS_PATH, "utf8");
    const { scenarios = [] } = JSON.parse(raw);
    const msg  = message.toLowerCase().trim();
    const lang = LANG_KEY[language] || "ru";

    // Проход 1: точное совпадение с границей слова (приоритет)
    for (const sc of scenarios) {
      const triggers: string[] = sc.triggers || [];
      const exact = triggers.some(t => {
        const tr = t.toLowerCase();
        return msg === tr ||
               msg.includes(" " + tr + " ") ||
               msg.startsWith(tr + " ") ||
               msg.endsWith(" " + tr);
      });
      if (exact) {
        const response = sc.responses?.[lang];
        if (response) {
          console.log(`📋 Датасет найден (точно): ${sc.id}`);
          return { id: sc.id as string, response };
        }
      }
    }

    // Проход 2: частичное вхождение
    for (const sc of scenarios) {
      const triggers: string[] = sc.triggers || [];
      const partial = triggers.some(t => msg.includes(t.toLowerCase()));
      if (partial) {
        const response = sc.responses?.[lang];
        if (response) {
          console.log(`📋 Датасет найден (частично): ${sc.id}`);
          return { id: sc.id as string, response };
        }
      }
    }
  } catch { /* файл не найден или повреждён */ }
  return null;
}

async function handleScenario(
  scenarioId:    string,
  userMessage:   string,
  quickResponse: string,
  guest:         GuestCtx,
  history:       Message[]
): Promise<{ reply: string; updatedHistory: Message[] }> {

  // Карта инструментов по ID сценария — явный вызов нужного инструмента
  const toolMap: Record<string, () => Promise<void>> = {

    "HK-001": async () => {
      await executeToolCall("create_housekeeping", {
        room_number: guest.roomNumber, task_type: "towels", priority: "normal",
        description: "Гость запросил свежие полотенца",
      }, guest);
    },
    "HK-002": async () => {
      await executeToolCall("create_housekeeping", {
        room_number: guest.roomNumber, task_type: "cleaning", priority: "normal",
        description: "Гость запросил уборку номера",
      }, guest);
    },
    "HK-003": async () => {
      await executeToolCall("create_housekeeping", {
        room_number: guest.roomNumber, task_type: "hairdryer", priority: "normal",
      }, guest);
    },
    "HK-004": async () => {
      await executeToolCall("create_housekeeping", {
        room_number: guest.roomNumber, task_type: "slippers", priority: "normal",
      }, guest);
    },

    "TX-001": async () => {
      await executeToolCall("arrange_taxi", {
        room_number:  guest.roomNumber,
        destination:  "Аэропорт Душанбе",
        pickup_time:  "уточнить у гостя",
        taxi_type:    "airport_transfer",
        passengers:   1,
      }, guest);
    },
    "TX-002": async () => {
      await executeToolCall("arrange_taxi", {
        room_number:  guest.roomNumber,
        destination:  "по городу",
        pickup_time:  "сейчас",
        taxi_type:    "standard",
        passengers:   1,
      }, guest);
    },

    "CO-001": async () => {
      await executeToolCall("escalate_to_staff", {
        room_number: guest.roomNumber,
        reason:      "Запрос позднего выезда до 16:00",
        priority:    "normal",
        summary:     `Комната ${guest.roomNumber} просит поздний выезд`,
      }, guest);
    },
    "CO-002": async () => {
      await executeToolCall("escalate_to_staff", {
        room_number: guest.roomNumber,
        reason:      "Запрос продления проживания",
        priority:    "normal",
        summary:     `Комната ${guest.roomNumber} хочет продлить проживание`,
      }, guest);
    },

    "CM-001": async () => {
      await executeToolCall("escalate_to_staff", {
        room_number: guest.roomNumber,
        reason:      "Жалоба гостя на сервис",
        priority:    "urgent",
        summary:     `⚠️ Комната ${guest.roomNumber} недовольна сервисом`,
      }, guest);
    },
    "CM-002": async () => {
      await executeToolCall("escalate_to_staff", {
        room_number: guest.roomNumber,
        reason:      "Жалоба на шум от соседей",
        priority:    "urgent",
        summary:     `🔇 Комната ${guest.roomNumber} — шумные соседи`,
      }, guest);
    },

    "EX-002": async () => {
      await executeToolCall("escalate_to_staff", {
        room_number: guest.roomNumber,
        reason:      "Запрос экскурсии",
        priority:    "normal",
        summary:     `🏔 Комната ${guest.roomNumber} интересуется экскурсиями`,
      }, guest);
    },

    // WK-001 (побудка) — инструмент не вызываем: нужно уточнить время у гостя
  };

  const toolFn = toolMap[scenarioId];
  if (toolFn) {
    try {
      await toolFn();
      console.log(`✅ Инструмент вызван для ${scenarioId}`);
    } catch (err: any) {
      console.error(`❌ Ошибка инструмента ${scenarioId}:`, err.message);
      logger.error(`handleScenario tool error [${scenarioId}]`, { err: err.message, room: guest.roomNumber });
    }
  }

  const now = new Date().toISOString();
  const updatedHistory: Message[] = [
    ...history,
    { role: "user" as const,      content: userMessage,    time: now },
    { role: "assistant" as const, content: quickResponse,  time: now },
  ].slice(-40);

  return { reply: quickResponse, updatedHistory };
}

// Groq использует OpenAI-совместимый API
const grok = new OpenAI({
  apiKey:  process.env.GROQ_API_KEY!,
  baseURL: "https://api.groq.com/openai/v1",
});

const MODEL_PRIMARY  = process.env.GROQ_MODEL_PRIMARY  || process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const MODEL_FALLBACK = process.env.GROQ_MODEL_FALLBACK || "llama-3.1-8b-instant";

// Retry with fallback model on 429/413
async function groqCreate(
  params: Omit<OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, "model"> & { model?: string }
): Promise<OpenAI.Chat.ChatCompletion> {
  const models = [params.model || MODEL_PRIMARY, MODEL_FALLBACK];

  for (let mi = 0; mi < models.length; mi++) {
    const model = models[mi];
    let msgs = params.messages;

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return await grok.chat.completions.create({ ...params, messages: msgs, model }) as OpenAI.Chat.ChatCompletion;
      } catch (err: any) {
        // 413: context too large — compact system + keep last user + trailing tool pair
        if (err.status === 413) {
          const compactSys: OpenAI.Chat.ChatCompletionMessageParam = {
            role: "system",
            content: "You are Ammar AI, hotel concierge. Be brief. Answer in the guest's language.",
          };
          const nonSys = msgs.filter(m => m.role !== "system");
          const lastUserIdx = [...nonSys].reverse().findIndex(m => m.role === "user");
          const relevant = lastUserIdx >= 0 ? nonSys.slice(nonSys.length - 1 - lastUserIdx) : nonSys.slice(-3);
          msgs = [compactSys, ...relevant];
          logger.warn("Groq 413 — trimmed context", { model, kept: msgs.length });
          if (attempt < 2) continue;
          // Still fails after trim → treat as rate-limit
          throw Object.assign(err, { status: 429 });
        }
        if (err.status !== 429 && err.status !== 413) throw err;
        const isLastTry = mi === models.length - 1 && attempt === 2;
        if (isLastTry) throw err;
        const wait = attempt === 1 && mi < models.length - 1 ? 0 : 10_000;
        if (wait) {
          logger.warn(`Groq 429 — waiting ${wait / 1000}s`, { model, attempt });
          await new Promise(r => setTimeout(r, wait));
        } else {
          logger.warn(`Groq 429 on ${model} — switching to ${MODEL_FALLBACK}`);
        }
      }
    }
  }
  throw new Error("Groq: all retry attempts exhausted");
}

export interface GuestCtx {
  guestId:     string;
  roomNumber?:  string;
  guestName?:   string;
  language:    "tajik" | "russian" | "english" | "chinese";
  platform:    "telegram" | "whatsapp" | "web";
  checkIn?:    string;
  checkOut?:   string;
}

export async function chat(
  userMessage: string,
  history:     Message[],
  guest:       GuestCtx
): Promise<{ reply: string; updatedHistory: Message[] }> {

  // Проверяем датасет — если нашли готовый ответ, вызываем инструмент и не тратим токены Groq
  const scenario = findScenario(userMessage, guest.language);
  if (scenario) {
    const result = await handleScenario(scenario.id, userMessage, scenario.response, guest, history);
    incMessages();
    broadcastEvent("message", {
      sessionKey: guest.guestId,
      room:       guest.roomNumber ?? "—",
      platform:   guest.platform,
      language:   guest.language,
      guestName:  guest.guestName,
      userMessage,
      botReply:   result.reply,
      time:       new Date().toISOString(),
    });
    logger.info(`✅ Датасет: ${scenario.id} (экономия токенов)`, { room: guest.roomNumber });
    return result;
  }

  const systemFull = buildSystem(guest);

  // Формируем историю для Grok
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemFull },
    ...history.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user", content: userMessage },
  ];

  let finalReply = "";
  let iterations = 0;

  const ACTION_TOOLS = new Set([
    "create_room_service",   "create_housekeeping",   "arrange_taxi",
    "request_wake_up",       "arrange_excursion",     "escalate_to_staff",
    "request_late_checkout", "request_room_extension","escalate_to_human",
  ]);

  // ── АГЕНТНЫЙ ЦИКЛ — wrapped so no exception ever escapes to the caller ──
  try {
  while (iterations < 4) {
    iterations++;

    let response;
    try {
      response = await groqCreate({
        messages,
        tools:       TOOLS,
        tool_choice: "auto",
        max_tokens:  700,
        temperature: 0.6,
      });
    } catch (apiErr: any) {
      if (apiErr.status === 429) {
        finalReply = rateLimitMsg(guest.language);
        break;
      }
      if (apiErr.status === 400) {
        // Tool call format error or decommissioned model — retry without tools
        logger.warn("Groq 400 — retrying without tools", { err: apiErr.message });
        try {
          const retry = await groqCreate({ messages, max_tokens: 512, temperature: 0.5 });
          finalReply = retry.choices[0].message.content || fallback(guest.language);
        } catch {
          finalReply = fallback(guest.language);
        }
        break;
      }
      throw apiErr;
    }

    const choice = response.choices[0];

    logger.debug("Groq response", {
      finish_reason: choice.finish_reason,
      room:          guest.roomNumber,
      iteration:     iterations,
    });

    // Модель дала текстовый ответ — готово
    if (choice.finish_reason === "stop" || !choice.message.tool_calls?.length) {
      finalReply = choice.message.content || fallback(guest.language);
      break;
    }

    // Модель вызывает инструменты
    if (choice.finish_reason === "tool_calls" && choice.message.tool_calls?.length) {
      messages.push(choice.message as OpenAI.Chat.ChatCompletionMessageParam);

      let calledAction = false;
      for (const toolCall of choice.message.tool_calls) {
        const toolName  = toolCall.function.name;
        const toolInput = JSON.parse(toolCall.function.arguments);

        logger.info(`⚙️  Tool: ${toolName}`, { room: guest.roomNumber, input: toolInput });

        const result = await executeToolCall(toolName, toolInput, guest);

        messages.push({
          role:         "tool",
          tool_call_id: toolCall.id,
          content:      JSON.stringify(result),
        });

        if (ACTION_TOOLS.has(toolName)) calledAction = true;
      }

      // После action-инструмента — финальный тёплый ответ без tools
      if (calledAction) {
        try {
          const final = await groqCreate({ messages, max_tokens: 350, temperature: 0.7 });
          finalReply = final.choices[0].message.content || fallback(guest.language);
        } catch (err: any) {
          finalReply = err.status === 429 ? rateLimitMsg(guest.language) : fallback(guest.language);
        }
        break;
      }

      continue;
    }

    finalReply = choice.message.content || fallback(guest.language);
    break;
  }

  // Лимит итераций исчерпан без текстового ответа — принудительно запрашиваем финал
  if (!finalReply) {
    try {
      const forced = await groqCreate({ messages, max_tokens: 350, temperature: 0.7 });
      finalReply = forced.choices[0].message.content || fallback(guest.language);
    } catch (err: any) {
      finalReply = err.status === 429 ? rateLimitMsg(guest.language) : fallback(guest.language);
    }
  }

  } catch (loopErr: any) {
    // Safety net: any uncaught error from the agent loop → friendly message
    logger.error("Agent loop uncaught error", { err: loopErr.message, status: loopErr.status });
    finalReply = loopErr.status === 429 ? rateLimitMsg(guest.language) : fallback(guest.language);
  }

  const now = new Date().toISOString();

  // Memory Buffer: последние 10 пар = 20 сообщений
  const updatedHistory: Message[] = [
    ...history,
    { role: "user" as const,      content: userMessage, time: now },
    { role: "assistant" as const, content: finalReply,  time: now },
  ].slice(-20);

  // Статистика и SSE-трансляция в админ-панель
  incMessages();
  broadcastEvent("message", {
    sessionKey:  guest.guestId,
    room:        guest.roomNumber  ?? "—",
    platform:    guest.platform,
    language:    guest.language,
    guestName:   guest.guestName,
    userMessage,
    botReply:    finalReply,
    time:        now,
  });

  return { reply: finalReply, updatedHistory };
}

// ── HELPERS ──────────────────────────────────────────────────

function buildSystem(guest: GuestCtx): string {
  const now  = new Date().toLocaleString("ru-RU", { timeZone: "Asia/Dushanbe" });
  const hour = new Date().toLocaleString("ru-RU", {
    timeZone: "Asia/Dushanbe", hour: "2-digit", hour12: false
  });
  const quiet = parseInt(hour) >= 22 || parseInt(hour) < 8;

  return getSystemPrompt() + `

═══════════════════════════════════════════════
ГОСТЬ СЕЙЧАС
═══════════════════════════════════════════════
Комната:   ${guest.roomNumber || "не привязана"}
Имя:       ${guest.guestName  || "не известно"}
Язык:      ${guest.language}
Платформа: ${guest.platform}
Время:     ${now}${quiet ? "\n⚠️  ТИХИЙ РЕЖИМ (22:00–08:00) — не делай upsell" : ""}
Заезд:     ${guest.checkIn  || "—"}
Выезд:     ${guest.checkOut || "—"}
`;
}

function fallback(lang: string): string {
  const r: Record<string, string> = {
    tajik:   "Бахшед, хато рух дод. Ба ресепшн занг занед: ☎️ 0",
    russian: "Извините, произошла ошибка. Позвоните на ресепшн: ☎️ 0",
    english: "Sorry, an error occurred. Please call reception: ☎️ 0",
    chinese: "抱歉，发生错误。请拨打前台电话：☎️ 0",
  };
  return r[lang] ?? r.russian;
}

function rateLimitMsg(lang: string): string {
  const r: Record<string, string> = {
    tajik:   "⏳ Лутфан як лаҳза сабр кунед...\nАгар ҷавоб дер шавад — ба ресепшн занг занед: ☎️ 0",
    russian: "⏳ Обрабатываю ваш запрос, одну секунду...\nЕсли ответ задерживается — позвоните: ☎️ 0",
    english: "⏳ Processing your request, one moment...\nIf the response is delayed — please call: ☎️ 0",
    chinese: "⏳ 正在处理您的请求，请稍候...\n如有延迟，请致电：☎️ 0",
  };
  return r[lang] ?? r.russian;
}
