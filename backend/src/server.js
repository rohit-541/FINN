import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(here, '../.env')); } catch { /* no .env is fine */ }

const { initStore, storeMode } = await import('./store.js');
const { digest, market, enrichById, loadCompanies } = await import('./push.js');
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

// ---------- access code ----------
// A shared code in ACCESS_CODE keeps a public deployment private until real sign-in exists.
// Unset (local development) means open. Every /api route below this block requires the code
// in the X-Finn-Code header; static files carry no data and stay public so the lock screen can load.
// Replace codeOk with a session check when the login page lands.
const ACCESS_CODE = process.env.ACCESS_CODE || '';
const hashOf = (v) => crypto.createHash('sha256').update(String(v)).digest();
const codeOk = (c) => !ACCESS_CODE || crypto.timingSafeEqual(hashOf(c), hashOf(ACCESS_CODE));
if (!ACCESS_CODE) console.warn('[access] ACCESS_CODE is not set: the API is open to anyone who can reach it.');
else if (ACCESS_CODE.length < 12) console.warn('[access] ACCESS_CODE is shorter than 12 characters; use a longer one.');

// Wrong codes are what a guesser produces, so only failures are counted: 10 per IP per 15 minutes.
const FAIL_MAX = 10, FAIL_WINDOW = 15 * 60_000;
const failures = new Map();
setInterval(() => { const now = Date.now(); for (const [k, v] of failures) if (v.reset < now) failures.delete(k); }, FAIL_WINDOW).unref();
const blocked = (ip) => { const f = failures.get(ip); return f && f.reset > Date.now() && f.n >= FAIL_MAX ? f : null; };
const fail = (ip) => {
  const now = Date.now();
  let f = failures.get(ip);
  if (!f || f.reset < now) { f = { n: 0, reset: now + FAIL_WINDOW }; failures.set(ip, f); }
  f.n++;
};
const tooMany = (res, f) => {
  res.set('Retry-After', String(Math.ceil((f.reset - Date.now()) / 1000)));
  return res.status(429).json({ error: 'Too many wrong codes. Try again later.' });
};

app.get('/api/access', (req, res) => res.json({ required: !!ACCESS_CODE, ok: codeOk(req.get('x-finn-code') || '') }));
app.post('/api/unlock', (req, res) => {
  const f = blocked(req.ip);
  if (f) return tooMany(res, f);
  if (codeOk(String(req.body?.code || '').slice(0, 200))) return res.json({ ok: true });
  fail(req.ip);
  res.status(401).json({ error: 'That code is not right.' });
});
app.use('/api', (req, res, next) => {
  if (!ACCESS_CODE) return next();
  const f = blocked(req.ip);
  if (f) return tooMany(res, f);
  if (codeOk(req.get('x-finn-code') || '')) return next();
  fail(req.ip);
  res.status(401).json({ error: 'Access code required.' });
});

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
  llm: llmInfo(), store: storeMode, feed: feedState, access: !!ACCESS_CODE,
})));

app.get('/api/digest', wrap(async (req, res) => {
  const now = Date.now();
  const to = Math.min(Number(req.query.to) || now, now);
  const from = Math.max(Number(req.query.from) || to - 864e5, to - 92 * 864e5); // at most ~3 months per request
  res.json(await digest({ tickers: tickersOf(req), from, to }));
}));

app.get('/api/market', wrap(async (req, res) => res.json(await market(tickersOf(req)))));

app.post('/api/enrich', (req, res, next) => (req.body?.read ? modelLimit(req, res, next) : next()), wrap(async (req, res) => {
  // Only the id and ticker are read from the client; the filing itself comes from the store.
  const id = req.body?.id;
  const ticker = String(req.body?.ticker || '').toUpperCase();
  if (typeof id !== 'string' || !id || id.length > 200 || !TICKER.test(ticker)) return res.status(400).json({ error: 'bad item' });
  try {
    res.json(await enrichById(id, ticker, { read: !!req.body.read }));
  } catch (e) {
    if (e.status === 404) return res.status(404).json({ error: e.message });
    throw e;
  }
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

// ---------- SEO ----------
// SITE_URL is the public origin (https://finn.example.com). Only its origin is used, so a path,
// query or stray character can never reach the page or the XML. Without it, canonical and share
// tags stay relative and no sitemap is served: an absolute URL is never built from the Host header.
const SITE_URL = (() => {
  try {
    const u = new URL(process.env.SITE_URL || '');
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : '';
  } catch { return ''; }
})();
if (!SITE_URL) console.warn('[seo] SITE_URL is not set: canonical tags stay relative and /sitemap.xml returns 404.');

app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').set('Cache-Control', 'public, max-age=86400').send(
    ['User-agent: *', 'Allow: /', 'Disallow: /api/', ...(SITE_URL ? [`Sitemap: ${SITE_URL}/sitemap.xml`] : [])].join('\n') + '\n',
  );
});

// The client routes by hash (#/brief), which crawlers ignore, so the home page is the one indexable URL.
app.get('/sitemap.xml', (_req, res) => {
  if (!SITE_URL) return res.status(404).type('text/plain').send('Set SITE_URL to publish a sitemap.\n');
  let lastmod = new Date().toISOString().slice(0, 10);
  try { lastmod = fs.statSync(path.join(dist, 'index.html')).mtime.toISOString().slice(0, 10); } catch { /* no build yet */ }
  res.type('application/xml').set('Cache-Control', 'public, max-age=86400').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_URL}/</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`);
});

if (fs.existsSync(dist)) {
  // index.html is served with __SITE_URL__ filled in; everything else is plain static files.
  const page = fs.readFileSync(path.join(dist, 'index.html'), 'utf8').replaceAll('__SITE_URL__', SITE_URL);
  const sendPage = (_req, res) => res.type('html').set('Cache-Control', 'no-cache').send(page);
  app.get('/', sendPage);
  app.use(express.static(dist, { index: false }));
  app.get(/^\/(?!api\/).*/, sendPage);
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
