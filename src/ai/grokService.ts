// src/ai/grokService.ts
// AI движок — Groq (groq.com), совместим с OpenAI SDK

import OpenAI from "openai";
import { getSystemPrompt } from "../utils/promptStore";
import { TOOLS }         from "../config/tools";
import { executeToolCall } from "../tools/executor";
import { logger }        from "../utils/logger";
import { Message }       from "../utils/redis";
import { broadcastEvent } from "../utils/adminEvents";
import { incMessages }   from "../utils/stats";
import { pmsClient }     from "../integrations/pmsClient";

// Gemini — основной провайдер (OpenAI-совместимый endpoint)
const geminiClient = new OpenAI({
  apiKey:  process.env.GEMINI_API_KEY!,
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
});

// Groq — резервный провайдер
const groqClient = new OpenAI({
  apiKey:  process.env.GROQ_API_KEY!,
  baseURL: "https://api.groq.com/openai/v1",
});

const MODEL_PRIMARY  = process.env.GEMINI_MODEL_PRIMARY || "gemini-2.0-flash";
const MODEL_FALLBACK = process.env.GROQ_MODEL_FALLBACK  || "llama-3.1-8b-instant";

// Жёсткий таймаут на весь chat() — переопределяется через env CHAT_TIMEOUT_MS
const CHAT_TIMEOUT_MS = parseInt(process.env.CHAT_TIMEOUT_MS ?? "") || 14_000;

// Один вызов на модель, без ожидания.
// 413 → trim context + retry той же моделью, затем fallback-модель.
// 429 → немедленно переключаемся на fallback-модель, без sleep.
async function groqCreate(
  params: Omit<OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, "model"> & { model?: string }
): Promise<OpenAI.Chat.ChatCompletion> {
  const models = [params.model || MODEL_PRIMARY, MODEL_FALLBACK];
  let msgs = params.messages;

  for (let mi = 0; mi < models.length; mi++) {
    const model = models[mi];
    // Gemini-модели → geminiClient, всё остальное (Groq/llama) → groqClient
    const client = model.startsWith("gemini") ? geminiClient : groqClient;
    try {
      return await client.chat.completions.create({ ...params, messages: msgs, model }) as OpenAI.Chat.ChatCompletion;
    } catch (err: any) {
      // 413: trim context, retry той же моделью один раз, затем следующая модель
      if (err.status === 413) {
        const compactSys: OpenAI.Chat.ChatCompletionMessageParam = {
          role: "system",
          content: "You are Ammar AI, hotel concierge. Be brief. Answer in the guest's language.",
        };
        const nonSys = msgs.filter(m => m.role !== "system");
        const lastUserIdx = [...nonSys].reverse().findIndex(m => m.role === "user");
        const relevant = lastUserIdx >= 0 ? nonSys.slice(nonSys.length - 1 - lastUserIdx) : nonSys.slice(-3);
        msgs = [compactSys, ...relevant];
        logger.warn("AI 413 — trimmed context", { model, provider: model.startsWith("gemini") ? "gemini" : "groq", kept: msgs.length });
        try {
          return await client.chat.completions.create({ ...params, messages: msgs, model }) as OpenAI.Chat.ChatCompletion;
        } catch (retryErr: any) {
          if (mi < models.length - 1) {
            logger.warn(`AI 413+retry failed — switching to ${models[mi + 1]}`);
            continue;
          }
          throw Object.assign(retryErr, { status: 429 });
        }
      }
      // Не-ретрайабельная ошибка — пробрасываем
      if (err.status !== 429) throw err;
      // 429: немедленно на следующую модель, без ожидания
      if (mi < models.length - 1) {
        logger.warn(`AI 429 on ${model} → switching to ${models[mi + 1]} (no wait)`);
        continue;
      }
      throw err; // Оба провайдера исчерпаны
    }
  }
  throw new Error("AI: all retry attempts exhausted");
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

  const systemFull = await buildSystem(guest);

  // Формируем историю для Groq
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemFull },
    ...history.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user", content: userMessage },
  ];

  let iterations = 0;

  const ACTION_TOOLS = new Set([
    "create_room_service",   "create_housekeeping",   "arrange_taxi",
    "request_wake_up",       "arrange_excursion",     "escalate_to_staff",
    "request_late_checkout", "request_room_extension","escalate_to_human",
    "order_service",
  ]);

  // ── АГЕНТНЫЙ ЦИКЛ (макс 3 итерации) ─────────────────────────────────────
  const runAgent = async (): Promise<string> => {
    let reply = "";

    try {
      while (iterations < 3) {
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
            reply = rateLimitMsg(guest.language);
            break;
          }
          if (apiErr.status === 400) {
            // Tool call format error — retry without tools
            logger.warn("Groq 400 — retrying without tools", { err: apiErr.message });
            try {
              const retry = await groqCreate({ messages, max_tokens: 512, temperature: 0.5 });
              reply = retry.choices[0].message.content || fallback(guest.language);
            } catch {
              reply = fallback(guest.language);
            }
            break;
          }
          throw apiErr;
        }

        const choice = response.choices[0];

        logger.debug("AI response", {
          finish_reason: choice.finish_reason,
          room:          guest.roomNumber,
          iteration:     iterations,
        });

        // tool_calls в приоритете над finish_reason — Gemini иногда возвращает
        // finish_reason="stop" вместе с tool_calls, поэтому проверяем наличие tool_calls первым.
        if (choice.message.tool_calls?.length) {
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
              reply = final.choices[0].message.content || fallback(guest.language);
            } catch (err: any) {
              reply = err.status === 429 ? rateLimitMsg(guest.language) : fallback(guest.language);
            }
            break;
          }

          continue;
        } else {
          // Нет tool_calls — текстовый ответ (stop / length / etc.)
          reply = choice.message.content || fallback(guest.language);
          break;
        }
      }

      // Лимит итераций исчерпан — принудительный финал
      if (!reply) {
        try {
          const forced = await groqCreate({ messages, max_tokens: 350, temperature: 0.7 });
          reply = forced.choices[0].message.content || fallback(guest.language);
        } catch (err: any) {
          reply = err.status === 429 ? rateLimitMsg(guest.language) : fallback(guest.language);
        }
      }

    } catch (loopErr: any) {
      logger.error("Agent loop uncaught error", { err: loopErr.message, status: loopErr.status });
      reply = loopErr.status === 429 ? rateLimitMsg(guest.language) : fallback(guest.language);
    }

    return reply || fallback(guest.language);
  };

  // ── ЖЁСТКИЙ ТАЙМАУТ — бот НЕ висит дольше CHAT_TIMEOUT_MS ───────────────
  const finalReply = await Promise.race([
    runAgent(),
    new Promise<string>(resolve =>
      setTimeout(() => {
        logger.warn("Chat timeout exceeded", { room: guest.roomNumber, ms: CHAT_TIMEOUT_MS });
        resolve(timeoutMsg(guest.language));
      }, CHAT_TIMEOUT_MS)
    ),
  ]);

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

async function buildSystem(guest: GuestCtx): Promise<string> {
  const now  = new Date().toLocaleString("ru-RU", { timeZone: "Asia/Dushanbe" });
  const hour = new Date().toLocaleString("ru-RU", {
    timeZone: "Asia/Dushanbe", hour: "2-digit", hour12: false
  });
  const quiet = parseInt(hour) >= 22 || parseInt(hour) < 8;

  // Live hotel services & policy from PMS (cached 60s, fails gracefully)
  const k = await pmsClient.getKnowledge().catch(() => null);
  let knowledgeSection = "";
  if (k) {
    const y = "✅", n = "❌";
    // BotKnowledge uses tg (not tj) for Tajik, zh for Chinese
    const pmsLangMap: Record<string, string> = { russian: "ru", tajik: "tg", english: "en", chinese: "zh" };
    const pl = pmsLangMap[guest.language] || "ru";
    const t = (obj: any): string => {
      if (!obj) return "";
      const v = (obj as Record<string, string>)[pl];
      return (v && v !== "") ? v : ((obj as Record<string, string>).ru || "");
    };
    knowledgeSection = `
═══════════════════════════════════════════════
УСЛУГИ ОТЕЛЯ (актуально из PMS)
═══════════════════════════════════════════════
Ресторан:      ${k.restaurantOpen ? `${y} открыт (${t(k.restaurantHours)})` : `${n} закрыт`}
Завтрак:       ${k.breakfastIncluded ? `${y} включён (${t(k.breakfastHours)}) — ${t(k.breakfastType)}` : `${n} не включён`}
Room service:  ${k.roomServiceAvailable ? `${y} (${t(k.roomServiceHours)})` : n}
Трансфер:      ${k.transferAvailable ? `${y}${t(k.transferInfo) ? ` — ${t(k.transferInfo)}` : ""}` : n}
Парковка:      ${k.parkingAvailable ? `${y}${t(k.parkingInfo) ? ` — ${t(k.parkingInfo)}` : ""}` : n}
Прачечная:     ${k.laundryAvailable ? y : n}
Спа:           ${k.spaAvailable ? `${y}${t(k.spaInfo) ? ` — ${t(k.spaInfo)}` : ""}` : n}
Конференц-зал: ${k.conferenceAvailable ? y : n}
Wi-Fi:         ${k.wifiAvailable ? `${y} — ${t(k.wifiInfo)}` : n}
Обмен валют:   ${k.currencyExchange ? y : n}
Заезд/выезд:   ${k.checkInTime} / ${k.checkOutTime}
Питомцы:       ${k.petsAllowed ? y : n}
Оплата:        ${t(k.paymentInfo)}
Отмена брони:  ${t(k.cancellationPolicy) || "уточняйте на ресепшн"}
Дети:          ${t(k.childrenPolicy) || "уточняйте на ресепшн"}
`;
  }

  return getSystemPrompt() + knowledgeSection + `
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

function timeoutMsg(lang: string): string {
  const r: Record<string, string> = {
    tajik:   "⏳ Дархост каме дер шуд. Лутфан дубора нависед ё ба ресепшн занг занед: ☎️ 0",
    russian: "⏳ Запрос занял слишком много времени. Напишите ещё раз или позвоните: ☎️ 0",
    english: "⏳ Request took too long. Please send your message again or call reception: ☎️ 0",
    chinese: "⏳ 请求超时，请重新发送消息或拨打前台：☎️ 0",
  };
  return r[lang] ?? r.russian;
}
