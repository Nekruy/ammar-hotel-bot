// src/utils/detectLanguage.ts — shared language detection for all platforms
import { Session } from "./redis";

export function detectLanguage(text: string): Session["language"] {
  if (/[一-鿿㐀-䶿]/.test(text)) return "chinese";
  if (/[а-яёА-ЯЁ]/.test(text)) {
    const tajikWords = /салом|мебахшед|лутфан|чой|номер|хочагй|ташаккур/i;
    return tajikWords.test(text) ? "tajik" : "russian";
  }
  return "english";
}
