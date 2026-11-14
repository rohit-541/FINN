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
app.use(cors());
app.use(express.json({ limit: '200kb' }));

const tickersOf = (req) => String(req.query.tickers || PORTFOLIO.join(','))
  .split(',').map((t) => t.trim().toUpperCase()).filter((t) => /^[A-Z0-9&-]{1,20}$/.test(t)).slice(0, 30);
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  console.error(`[${req.path}]`, e.message);
  res.status(502).json({ error: e.message });
});

app.get('/api/meta', wrap(async (_req, res) => res.json({
  portfolio: PORTFOLIO, picks: RESEARCH_PICKS, categories: CATEGORY_LABEL,
  llm: llmInfo(), store: storeMode, feed: feedState,
})));

app.get('/api/digest', wrap(async (req, res) => {
  const to = Number(req.query.to) || Date.now();
  const from = Number(req.query.from) || to - 864e5;
  res.json(await digest({ tickers: tickersOf(req), from, to }));
}));

app.get('/api/market', wrap(async (req, res) => res.json(await market(tickersOf(req)))));

app.post('/api/enrich', wrap(async (req, res) => {
  const { item, read } = req.body || {};
  if (!item?.id || !item?.ticker || !/^https:\/\/([a-z0-9-]+\.)*(nseindia|bseindia)\.com\//.test(item.url || '')) {
    return res.status(400).json({ error: 'bad item' });
  }
  res.json(await enrich(item, { read: !!read }));
}));

app.get('/api/search', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 40);
  res.json(q.length < 2 ? [] : await search(q));
}));

app.get('/api/research/:ticker', wrap(async (req, res) => res.json(await facts(req.params.ticker))));
app.get('/api/research/:ticker/analysis', wrap(async (req, res) => res.json(analysis(req.params.ticker))));
app.post('/api/research/:ticker/ask', wrap(async (req, res) => {
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
