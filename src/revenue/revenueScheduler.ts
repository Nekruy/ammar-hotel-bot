import { parseBookingPrice } from './competitorParser';
import { analyzeAndRecommend } from './revenueAnalyzer';
import { notifyStaff }         from '../integrations/staffNotifier';
import { logger }              from '../utils/logger';
import fs   from 'fs';
import path from 'path';

const DATA = (file: string) => path.join(process.cwd(), 'src/data', file);

export function startRevenueScheduler(): void {
  // Run every 6 hours
  setInterval(() => {
    runRevenueAnalysis().catch(err =>
      logger.warn('Revenue scheduler error', { err: err.message })
    );
  }, 6 * 60 * 60 * 1000);

  logger.info('📊 Revenue scheduler: analysis every 6h');
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
