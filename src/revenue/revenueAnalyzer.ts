import OpenAI from 'openai';
import { CompetitorPrice } from './competitorParser';
import { logger } from '../utils/logger';
import fs   from 'fs';
import path from 'path';

const groq = new OpenAI({
  apiKey:  process.env.GROQ_API_KEY!,
  baseURL: 'https://api.groq.com/openai/v1',
});

const DATA = (file: string) => path.join(process.cwd(), 'src/data', file);

export interface RevenueRecommendation {
  id:          string;
  date:        string;
  period:      string;
  reason:      string;
  current:     { standard: number; superior: number; suite: number };
  recommended: { standard: number; superior: number; suite: number };
  competitors: CompetitorPrice[];
  analysis:    string;
  urgency:     'low' | 'medium' | 'high';
  status:      'pending' | 'accepted' | 'rejected';
  decidedAt?:  string;
}

export async function analyzeAndRecommend(
  competitors: CompetitorPrice[],
  events:      any[],
  ourPrices:   { standard: number; superior: number; suite: number }
): Promise<RevenueRecommendation> {

  const competitorText = competitors
    .filter(c => c.standard > 0)
    .map(c => `${c.hotel}: Standard $${c.standard}, Superior $${c.superior}, Suite $${c.suite}`)
    .join('\n') || 'Данные о конкурентах временно недоступны';

  const now      = new Date();
  const eventText = events
    .filter(e => {
      const diff = (new Date(e.date).getTime() - now.getTime()) / 86400000;
      return diff >= -1 && diff <= 90;
    })
    .map(e => `${e.date}: ${e.name} (${e.impact})`)
    .join('\n') || 'Особых событий нет';

  const prompt = `Ты — Revenue Manager отеля AMMAR Hotel (5★, Душанбе, Таджикистан).

НАШИ ЦЕНЫ:
Standard: $${ourPrices.standard}
Superior: $${ourPrices.superior}
Suite:    $${ourPrices.suite}

КОНКУРЕНТЫ:
${competitorText}

СОБЫТИЯ (ближайшие 90 дней):
${eventText}

Дай рекомендацию по ценам. Ответь ТОЛЬКО JSON (без markdown):
{
  "period": "конкретный период или 'ближайшие 7 дней'",
  "reason": "одно предложение — главная причина",
  "recommended": {"standard": число, "superior": число, "suite": число},
  "analysis": "2-3 предложения анализа ситуации",
  "urgency": "low|medium|high"
}`;

  let result: any = null;
  try {
    const resp = await groq.chat.completions.create({
      model:       process.env.GROQ_MODEL_PRIMARY || 'llama-3.3-70b-versatile',
      messages:    [{ role: 'user', content: prompt }],
      max_tokens:  450,
      temperature: 0.3,
    });
    const text = resp.choices[0].message.content || '{}';
    result = JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch (e: any) {
    logger.warn('Revenue AI parse failed', { err: e.message });
  }

  const rec: RevenueRecommendation = {
    id:          `REC-${Date.now()}`,
    date:        new Date().toISOString(),
    period:      result?.period      || 'ближайшие 7 дней',
    reason:      result?.reason      || 'Плановый анализ рыночной ситуации',
    current:     ourPrices,
    recommended: result?.recommended || ourPrices,
    competitors,
    analysis:    result?.analysis    || 'Рекомендуется продолжать мониторинг цен конкурентов.',
    urgency:     result?.urgency     || 'low',
    status:      'pending',
  };

  saveRecommendation(rec);
  return rec;
}

function saveRecommendation(rec: RevenueRecommendation) {
  const fp = DATA('revenue_recommendations.json');
  let existing: RevenueRecommendation[] = [];
  try { existing = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch {}
  existing.unshift(rec);
  fs.writeFileSync(fp, JSON.stringify(existing.slice(0, 50), null, 2));
}
