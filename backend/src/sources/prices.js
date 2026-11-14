// End-of-day price and volume. Yahoo Finance first (the same chart endpoint yfinance uses),
// Screener's chart as the fallback, so a throttled Yahoo never blanks the screen.
import { get } from './http.js';
import { cached } from '../store.js';
import { chart as screenerChart } from './screener.js';

const TTL = 20 * 60 * 1000;

async function yahoo(symbol) {
  const d = await get(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`,
    { as: 'json', concurrency: 4 },
  );
  const r = d.chart?.result?.[0];
  if (!r?.timestamp) throw new Error('empty Yahoo chart');
  const q = r.indicators.quote[0];
  return r.timestamp
    .map((t, i) => ({
      date: new Date((t + (r.meta.gmtoffset || 19800)) * 1000).toISOString().slice(0, 10),
      close: q.close[i], volume: q.volume[i],
    }))
    .filter((b) => b.close != null);
}

const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

/** The raw facts the alert rules run on. Thresholds are applied in the client, instantly. */
export function summarise(bars, source) {
  if (bars.length < 2) return null;
  const last = bars.at(-1), prev = bars.at(-2);
  const prior = bars.slice(-21, -1).map((b) => b.volume).filter((v) => v > 0);
  const avgVol = avg(prior);
  const closes = bars.map((b) => b.close);
  const ret = (n) => (bars.length > n ? (last.close / bars.at(-1 - n).close - 1) * 100 : null);
  return {
    date: last.date,
    close: last.close,
    changePct: (last.close / prev.close - 1) * 100,
    volume: last.volume,
    avgVolume20: avgVol,
    volumeRatio: avgVol && last.volume ? last.volume / avgVol : null,
    ret5: ret(5), ret21: ret(21),
    high52: Math.max(...closes), low52: Math.min(...closes),
    spark: closes.slice(-30),
    source,
  };
}

export function quote(c) {
  return cached(`quote:${c.ticker}`, TTL, async () => {
    const symbol = c.nse ? `${c.nse}.NS` : c.bse ? `${c.bse}.BO` : `${c.ticker}.NS`;
    try {
      return summarise(await yahoo(symbol), 'Yahoo Finance');
    } catch {
      if (!c.id) throw new Error(`No price source for ${c.ticker}`);
      return summarise(await screenerChart(c.id), 'Screener');
    }
  });
}
