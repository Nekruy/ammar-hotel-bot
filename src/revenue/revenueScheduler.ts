import { parseBookingPrice } from './competitorParser';
import { analyzeAndRecommend } from './revenueAnalyzer';
import { notifyStaff }         from '../integrations/staffNotifier';
import { logger }              from '../utils/logger';
import fs   from 'fs';
import path from 'path';

const DATA = (file: string) => path.join(process.cwd(), 'src/data', file);

// Dushanbe is UTC+5
const DUSHANBE_OFFSET_H = 5;

function dushanbeHour(): number {
  return (new Date().getUTCHours() + DUSHANBE_OFFSET_H) % 24;
}

function todayDushanbe(): string {
  const now = new Date();
  now.setUTCHours(now.getUTCHours() + DUSHANBE_OFFSET_H);
  return now.toISOString().slice(0, 10);
}

let lastDailyReportDate = '';

export function startRevenueScheduler(): void {
  // Full analysis every 6 hours
  setInterval(() => {
    runRevenueAnalysis().catch(err =>
      logger.warn('Revenue scheduler error', { err: err.message })
    );
  }, 6 * 60 * 60 * 1000);

  // Daily 8:00 AM Dushanbe morning report — check every minute
  setInterval(() => {
    const today = todayDushanbe();
    const hour  = dushanbeHour();
    if (hour === 8 && lastDailyReportDate !== today) {
      lastDailyReportDate = today;
      sendDailyReport().catch(err =>
        logger.warn('Daily report error', { err: err.message })
      );
    }
  }, 60_000);

  logger.info('📊 Revenue scheduler: analysis every 6h, daily report at 08:00 Dushanbe');
}

export async function runRevenueAnalysis() {
  logger.info('📊 Revenue AI: starting analysis…');

  const competitors: any[] = JSON.parse(fs.readFileSync(DATA('competitors.json'), 'utf8'));

  let events: any[] = [];
  try { events = JSON.parse(fs.readFileSync(DATA('revenue_events.json'), 'utf8')); } catch {}

  const facts     = JSON.parse(fs.readFileSync(DATA('hotel_facts.json'), 'utf8'));
  const ourPrices = (facts.prices?.rooms) || { standard: 80, superior: 120, suite: 200 };

  const competitorPrices = await Promise.all(
    competitors.map((c: any) => parseBookingPrice(c.bookingUrl || c.url || '', c.name))
  );

  const rec = await analyzeAndRecommend(competitorPrices, events, ourPrices);

  try {
    await notifyStaff('gm' as any, {
      type:    '📊 Revenue AI — Рекомендация',
      room:    'Revenue',
      message: `${rec.period} | ${rec.reason} | Standard: $${ourPrices.standard} → $${rec.recommended.standard}`,
    });
  } catch { /* gm channel may not be configured */ }

  logger.info('✅ Revenue analysis done', { id: rec.id, urgency: rec.urgency });
  return rec;
}

async function sendDailyReport(): Promise<void> {
  logger.info('📅 Sending daily revenue report (08:00 Dushanbe)');

  let recs: any[] = [];
  try { recs = JSON.parse(fs.readFileSync(DATA('revenue_recommendations.json'), 'utf8')); } catch {}

  let events: any[] = [];
  try { events = JSON.parse(fs.readFileSync(DATA('revenue_events.json'), 'utf8')); } catch {}

  const latest = recs[0];
  const today  = todayDushanbe();

  // Upcoming events in the next 7 days
  const upcoming = events.filter(e => {
    const diff = (new Date(e.date).getTime() - new Date(today).getTime()) / 86400000;
    return diff >= 0 && diff <= 7;
  });

  const impactLabel: Record<string, string> = {
    very_high: '🔴 Очень высокий',
    high:      '🟠 Высокий',
    medium:    '🟡 Средний',
    low:       '🟢 Низкий',
  };

  let message = `📅 Доброе утро! Ежедневный отчёт Revenue — ${today}\n\n`;

  if (latest) {
    message += `💰 Актуальные рекомендации (${latest.period}):\n`;
    message += `Standard: $${latest.current.standard} → $${latest.recommended.standard}\n`;
    message += `Superior: $${latest.current.superior} → $${latest.recommended.superior}\n`;
    message += `Suite: $${latest.current.suite} → $${latest.recommended.suite}\n`;
    message += `\n📝 ${latest.reason}\n`;
    message += `📊 Срочность: ${latest.urgency === 'high' ? '🔴 Высокая' : latest.urgency === 'medium' ? '🟡 Средняя' : '🟢 Низкая'}\n`;
  }

  if (upcoming.length > 0) {
    message += `\n📆 События ближайших 7 дней:\n`;
    for (const e of upcoming) {
      const label = impactLabel[e.impact] || e.impact;
      message += `• ${e.date}: ${e.name} — ${label}\n`;
    }
  } else {
    message += `\n📆 Особых событий в ближайшие 7 дней нет.\n`;
  }

  try {
    await notifyStaff('gm' as any, {
      type:    '☀️ Утренний Revenue отчёт',
      room:    'Revenue',
      message,
    });
    logger.info('✅ Daily revenue report sent');
  } catch (err: any) {
    logger.warn('Daily report: notifyStaff failed', { err: err.message });
  }
}
