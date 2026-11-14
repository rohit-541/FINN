import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(here, '../.env')); } catch { /* no .env is fine */ }

const { initStore, storeMode } = await import('./store.js');
const { digest, market, enrich, loadCompanies } = await import('./push.js');
const { facts, analysis, ask } = await import('./research.js');
const { search } = await import('./sources/screener.js');
const { pollNse, feedState } = await import('./sources/nse.js');
const { llmInfo } = await import('./llm.js');
const { CATEGORY_LABEL } = await import('./classify.js');

// A mock portfolio across sectors and sizes. The client can replace it; nothing is hard-wired.
const PORTFOLIO = ['RELIANCE', 'HDFCBANK', 'TCS', 'INFY', 'BHARTIARTL', 'LT', 'ITC', 'MARUTI', 'SUNPHARMA', 'TITAN',
  'BAJFINANCE', 'ASIANPAINT', 'DIXON', 'POLYCAB', 'PERSISTENT', 'TRENT', 'DEEPAKNTR', 'KPITTECH'];
const RESEARCH_PICKS = ['ETERNAL', 'TATASTEEL', 'HAL', 'PIDILITIND'];

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', Number(process.env.TRUST_PROXY || 0)); // set to 1 behind one reverse proxy so rate limits see the real client

// Baseline security headers. The client is self-hosted except Google Fonts.
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': [
      "default-src 'self'", "script-src 'self'", "style-src 'self' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data:", "connect-src 'self'",
      "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'",
    ].join('; '),
  });
  next();
});

// The backend serves its own client, so browsers need no CORS. A separately hosted client
// is allowed only when its origin is listed in CORS_ORIGIN (comma separated).
const origins = (process.env.CORS_ORIGIN || '').split(',').map((o) => o.trim()).filter(Boolean);
if (origins.length) app.use('/api', cors({ origin: origins }));
app.use(express.json({ limit: '50kb' }));

// Fixed-window limiter in memory, per client IP. Enough for one instance; use a shared store if scaled out.
function limiter(name, max, windowMs) {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, windowMs).unref();
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset < now) { h = { n: 0, reset: now + windowMs }; hits.set(key, h); }
    if (++h.n > max) {
      res.set('Retry-After', String(Math.ceil((h.reset - now) / 1000)));
      return res.status(429).json({ error: `Too many ${name} requests. Try again shortly.` });
    }
    next();
  };
}
const apiLimit = limiter('API', 300, 60_000);
const modelLimit = limiter('model', Number(process.env.MODEL_RATE_LIMIT || 30), 10 * 60_000);
app.use('/api', apiLimit);

const TICKER = /^[A-Z0-9&-]{1,20}$/;
const tickersOf = (req) => String(req.query.tickers || PORTFOLIO.join(','))
  .split(',').map((t) => t.trim().toUpperCase()).filter((t) => TICKER.test(t)).slice(0, 30);
app.param('ticker', (req, res, next, t) => {
  const up = String(t).toUpperCase();
  if (!TICKER.test(up)) return res.status(400).json({ error: 'Unknown ticker format.' });
  req.params.ticker = up;
  next();
});

// Known, safe messages pass through; anything else is logged here and returned as a generic line,
// so stack traces, upstream URLs and file paths never reach the client.
const SAFE = /^(daily model budget reached|model gave no answer|NO_LLM|no data|not found|no such company|bad item)/i;
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  console.error(`[${req.method} ${req.path}]`, e.stack || e.message);
  res.status(502).json({ error: SAFE.test(e.message) ? e.message : 'A data source did not answer. Try again in a minute.' });
});

app.get('/api/meta', wrap(async (_req, res) => res.json({
  portfolio: PORTFOLIO, picks: RESEARCH_PICKS, categories: CATEGORY_LABEL,
  llm: llmInfo(), store: storeMode, feed: feedState,
})));

app.get('/api/digest', wrap(async (req, res) => {
  const now = Date.now();
  const to = Math.min(Number(req.query.to) || now, now);
  const from = Math.max(Number(req.query.from) || to - 864e5, to - 92 * 864e5); // at most ~3 months per request
  res.json(await digest({ tickers: tickersOf(req), from, to }));
}));

app.get('/api/market', wrap(async (req, res) => res.json(await market(tickersOf(req)))));

app.post('/api/enrich', (req, res, next) => (req.body?.read ? modelLimit(req, res, next) : next()), wrap(async (req, res) => {
  const { item, read } = req.body || {};
  if (typeof item?.id !== 'string' || !TICKER.test(String(item?.ticker || '').toUpperCase())
    || !/^https:\/\/([a-z0-9-]+\.)*(nseindia|bseindia)\.com\//.test(item.url || '')) {
    return res.status(400).json({ error: 'bad item' });
  }
  res.json(await enrich(item, { read: !!read }));
}));

app.get('/api/search', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 40);
  res.json(q.length < 2 ? [] : await search(q));
}));

app.get('/api/research/:ticker', wrap(async (req, res) => res.json(await facts(req.params.ticker))));
// The client polls this while a job runs, so only distinct companies count: each new one starts ~30k tokens of reading.
const started = new Map(); // ip -> { tickers: Set, reset }
setInterval(() => { const now = Date.now(); for (const [k, v] of started) if (v.reset < now) started.delete(k); }, 60 * 60_000).unref();
app.get('/api/research/:ticker/analysis', wrap(async (req, res) => {
  const now = Date.now();
  let s = started.get(req.ip);
  if (!s || s.reset < now) { s = { tickers: new Set(), reset: now + 60 * 60_000 }; started.set(req.ip, s); }
  if (!s.tickers.has(req.params.ticker) && s.tickers.size >= Number(process.env.ANALYSIS_PER_HOUR || 12)) {
    return res.status(429).json({ error: 'Too many new company analyses this hour. Companies already read still open.' });
  }
  s.tickers.add(req.params.ticker);
  res.json(analysis(req.params.ticker));
}));
app.post('/api/research/:ticker/ask', modelLimit, wrap(async (req, res) => {
  const q = String(req.body?.question || '').trim().slice(0, 300);
  if (q.length < 3) return res.status(400).json({ error: 'empty question' });
  res.json(await ask(req.params.ticker, q));
}));

// In production the same server hands out the built client, so there is one thing to deploy.
const dist = path.join(here, '../../frontend/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

await initStore();
const port = Number(process.env.PORT) || 3001;
app.listen(port, () => {
  console.log(`FINN backend on http://localhost:${port}  (model: ${llmInfo().enabled ? llmInfo().provider : 'none, rules only'})`);
  // Keep the filings history growing and the portfolio warm, so the first open is instant.
  pollNse(true);
  setInterval(() => pollNse(true), 5 * 60 * 1000).unref();
  loadCompanies(PORTFOLIO).then(() => market(PORTFOLIO)).catch(() => {});
});
