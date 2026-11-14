// Push: the windowed digest, the end-of-day movers, and the per-item enrichment.
// Nothing here calls a model until a person is looking at a material item.
import { company } from './sources/screener.js';
import { quote } from './sources/prices.js';
import { pollNse, backfill, feedState } from './sources/nse.js';
import { mapLimit } from './sources/http.js';
import { findFilings } from './store.js';
import { classify, headline, CATEGORY_LABEL } from './classify.js';
import { pages } from './docs.js';
import { llmJson, llmInfo } from './llm.js';

const istDay = (ts) => new Date(ts + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

export async function loadCompanies(tickers) {
  const out = await mapLimit(tickers, 3, (t) => company(t));
  return out.filter((c) => c && !c.error);
}

export async function digest({ tickers, from, to }) {
  const cos = await loadCompanies(tickers);
  await Promise.all([pollNse(), ...cos.map(backfill)]);
  const rows = await findFilings({ companies: cos, from, to });

  const owner = (f) => cos.find((c) => c.ticker === f.ticker || (c.nse && c.nse === f.ticker) || c.nameNorm === f.nameNorm);
  const groups = new Map();
  for (const f of rows) {
    const c = owner(f);
    if (!c) continue;
    const item = {
      id: f._id, ticker: c.ticker, company: c.name, src: f.src, title: f.title, headline: headline(f),
      summary: f.summary, url: f.url, ts: f.ts, ...classify(f),
    };
    item.label = item.tag || CATEGORY_LABEL[item.category];
    // The same event is filed on both exchanges, often with an advert and a deck beside it.
    // One event, one row: the most material filing leads and the rest ride along.
    const key = `${c.ticker}|${item.category}|${istDay(f.ts)}`;
    const g = groups.get(key);
    if (!g) groups.set(key, { ...item, related: [] });
    else if (item.tier > g.tier || (item.tier === g.tier && rank(item) > rank(g))) {
      const { related, ...old } = g;
      groups.set(key, { ...item, related: [...related, slim(old)] });
    } else g.related.push(slim(item));
  }
  const items = [...groups.values()].sort((a, b) => b.tier - a.tier || b.ts - a.ts);
  return {
    from, to,
    filings: rows.length,
    items,
    companies: cos.map((c) => ({ ticker: c.ticker, name: c.name })),
    missing: tickers.filter((t) => !cos.some((c) => c.ticker === t.toUpperCase())),
    feed: feedState,
  };
}
// a readable PDF beats an XBRL stub; a specific sentence beats a generic subject line
const rank = (i) => (/\.xml$/i.test(i.url) ? 0 : 1000) + (i.headline === i.title ? 0 : 500) + Math.min(i.headline.length, 400);
const slim = ({ id, title, label, url, src, ts }) => ({ id, title, label, url, src, ts });

export async function market(tickers) {
  const cos = await loadCompanies(tickers);
  const rows = await mapLimit(cos, 4, async (c) => ({ ticker: c.ticker, name: c.name, ...(await quote(c)) }));
  return rows.filter((r) => r && !r.error && r.close != null);
}

// ---------- enrichment ----------
const pct = (now, base) => (now == null || base == null || base <= 0 ? null : (now / base - 1) * 100);
const pick = (rows, ...names) => names.map((n) => rows[n]).find(Boolean);

/** First cut of a results filing: the four headline lines, QoQ and YoY. No model involved. */
export function resultsCard(c, filedAt) {
  const { cols, rows } = c.quarters;
  const i = cols.length - 1;
  if (i < 1) return null;
  const line = (label, v) => v && v[i] != null
    ? { label, now: v[i], prev: v[i - 1] ?? null, yearAgo: v[i - 4] ?? null, qoq: pct(v[i], v[i - 1]), yoy: pct(v[i], v[i - 4]) }
    : null;
  const financial = !!rows['Financing Profit'];
  const lines = [
    line('Revenue', pick(rows, 'Sales', 'Revenue')),
    line(financial ? 'Financing profit' : 'EBITDA', pick(rows, 'Operating Profit', 'Financing Profit')),
    line('PBT', rows['Profit before tax']),
    line('PAT', rows['Net Profit']),
  ].filter(Boolean);
  const m = pick(rows, 'OPM %', 'Financing Margin %');
  const periodEnd = Date.parse(`1 ${cols[i]} UTC`) + 31 * 864e5;
  return {
    period: cols[i], prevPeriod: cols[i - 1], yearAgoPeriod: cols[i - 4] ?? null,
    view: c.view, unit: '₹ Cr', lines,
    margin: m && m[i] != null ? { now: m[i], yoyPts: m[i - 4] != null ? m[i] - m[i - 4] : null } : null,
    // the standardised table can trail a fresh filing by a few hours; say so rather than mislead
    behind: filedAt ? filedAt - periodEnd > 110 * 864e5 : false,
  };
}

const PERSON_RE = /(appointment|re-?appointment|resignation|cessation|retirement|superannuation|demise) of\s+(?:(?:mr|ms|mrs|dr|shri|smt|prof)\.?\s+)?(.+?)\s*(?:\(din[^)]*\))?\s+(?:as|from the (?:post|position) of)\s+(?:an?\s+|the\s+)?(.+?)(?:\s+of the company|\s+w\.?e\.?f|\s+with effect|[.,]|$)/i;

async function people(f) {
  if (llmInfo().enabled) {
    try {
      const text = (await pages(f.url)).join('\n').slice(0, 9000);
      if (text.length > 200) {
        const out = await llmJson({
          tier: 'fast',
          system: 'You read an Indian stock-exchange filing about a change in directors or senior management. Use only the filing text. Never add facts from memory.',
          user: `Filing: ${f.title}\n${f.summary}\n\n${text}\n\nReturn {"people":[{"name":"","role":"the post concerned","change":"appointed|reappointed|resigned|retired|ceased","effective":"date or ''","reason":"stated reason, 12 words at most, or ''","background":"for someone joining: where they come from and what they have run, 40 words at most, from the brief profile in the filing; '' if none","previous":["up to 3 earlier employers or posts"]}]} with at most 3 people.`,
          maxTokens: 700,
        });
        if (out.people?.length) return { people: out.people, source: 'filing' };
      }
    } catch { /* fall through to the free reading */ }
  }
  const text = `${f.summary} ${f.title}`;
  const m = text.match(PERSON_RE);
  if (!m) {
    // "HDFC Bank reappointed V. Srinivasa Rangan as Executive Director for one year"
    const v = text.match(/\b(re-?appointed|appointed|named)\s+(?:(?:mr|ms|mrs|dr|shri|smt)\.?\s+)?([A-Z][\w.' -]+?)\s+as\s+(?:an?\s+|the\s+)?(.+?)(?:\s+(?:for|from|with|w\.?e\.?f)\b|[.,;]|$)/);
    if (!v) return null;
    return { people: [{ name: v[2].trim(), role: v[3].trim(), change: /^re/i.test(v[1]) ? 'reappointed' : 'appointed', effective: '', reason: '', background: '', previous: [] }], source: 'headline' };
  }
  const w = m[1].toLowerCase();
  const change = /^re-?appoint/.test(w) ? 'reappointed' : w.startsWith('appoint') ? 'appointed'
    : w.startsWith('resign') ? 'resigned' : /^(retire|superann)/.test(w) ? 'retired' : 'ceased';
  return { people: [{ name: m[2].trim(), role: m[3].trim(), change, effective: '', reason: '', background: '', previous: [] }], source: 'headline' };
}

async function brief(f) {
  const text = (await pages(f.url)).join('\n').slice(0, 10000);
  if (text.length < 200) return null;
  return llmJson({
    tier: 'fast',
    system: 'You brief a portfolio manager on one stock-exchange filing. Use only the filing text. Plain words, no adjectives of praise, no advice.',
    user: `Filing: ${f.title}\n${f.summary}\n\n${text}\n\nReturn {"what":"what happened, 22 words at most, with the key figure","why":"why a shareholder would care, 22 words at most, or '' if it changes nothing","numbers":[{"label":"","value":""}]} with at most 3 numbers taken verbatim from the filing.`,
    maxTokens: 400,
  });
}

export async function enrich(item, { read = false } = {}) {
  const out = { id: item.id };
  if (item.category === 'results' && item.tier === 3) {
    const [c] = await loadCompanies([item.ticker]);
    if (c) out.results = resultsCard(c, item.ts);
  }
  if (item.category === 'management_change') out.people = await people(item);
  if (read) {
    if (!llmInfo().enabled) out.needsKey = true;
    else try { out.brief = await brief(item); } catch (e) { out.briefError = e.message; }
  }
  return out;
}
