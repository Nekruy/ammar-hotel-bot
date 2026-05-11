// src/reputation/reviewAI.ts
import OpenAI from "openai";
import { logger } from "../utils/logger";

const groq = new OpenAI({
  apiKey:  process.env.GROQ_API_KEY || "",
  baseURL: "https://api.groq.com/openai/v1",
});

export interface ReviewResponse {
  ru: string;
  en: string;
  cn: string;
}

export async function generateReviewResponse(
  review:     string,
  rating:     number,
  guestName:  string,
  language:   string
): Promise<ReviewResponse> {
  const sentiment = rating >= 4 ? "позитивный" : rating === 3 ? "нейтральный" : "негативный";
  const action    = rating >= 4
    ? "поблагодари и пригласи снова"
    : rating === 3
    ? "поблагодари, отметь что примешь к сведению"
    : "извинись искренне, пообещай улучшения";

  const prompt =
    `Ты менеджер по репутации отеля AMMAR Hotel (5 звёзд, Душанбе, Таджикистан).\n` +
    `Напиши профессиональный ответ на отзыв гостя.\n\n` +
    `Гость: ${guestName || "Уважаемый гость"}\n` +
    `Рейтинг: ${rating}/5 (${sentiment})\n` +
    `Отзыв: "${review}"\n\n` +
    `Правила:\n` +
    `- Обращайся по имени если оно есть\n` +
    `- ${action}\n` +
    `- Максимум 3 предложения на каждом языке\n` +
    `- Тёплый, профессиональный тон\n` +
    `- Упомяни название отеля AMMAR Hotel\n\n` +
    `Ответь СТРОГО в JSON без markdown:\n` +
    `{"ru":"ответ на русском","en":"english response","cn":"中文回复"}`;

  try {
    const res = await groq.chat.completions.create({
      model:       process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      messages:    [{ role: "user", content: prompt }],
      max_tokens:  500,
      temperature: 0.7,
    });

    const raw  = res.choices[0].message.content || "{}";
    const json = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(json);
    if (parsed.ru && parsed.en && parsed.cn) return parsed;
    throw new Error("Incomplete JSON");
  } catch (err: any) {
    logger.warn(`reviewAI fallback: ${err.message}`);
    const name = guestName || "Уважаемый гость";
    return {
      ru: `Дорогой ${name}! Большое спасибо за ваш отзыв — мы очень ценим ваше мнение. ${rating >= 4 ? "Будем рады видеть вас снова в AMMAR Hotel! 🏨" : "Мы примем все замечания к сведению и обязательно улучшим сервис. 🙏"}`,
      en: `Dear ${name}! Thank you so much for your feedback — it means a lot to us. ${rating >= 4 ? "We look forward to welcoming you back to AMMAR Hotel! 🏨" : "We take your comments seriously and will work to improve. 🙏"}`,
      cn: `亲爱的${name}！非常感谢您的评价，我们非常重视您的意见。${rating >= 4 ? "期待再次在AMMAR Hotel见到您！🏨" : "我们会认真对待您的意见并努力改善服务。🙏"}`,
    };
  }
}
