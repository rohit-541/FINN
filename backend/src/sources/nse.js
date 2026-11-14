// NSE publishes every corporate announcement in a public RSS feed that rolls over within a
// day. FINN polls it and keeps what it sees, so the digest window can reach further back
// than the feed does. Items carry a company name, not a symbol; they are matched by name.
import { get } from './http.js';
import { sha, upsertFilings } from '../store.js';
import { normName } from './screener.js';

const FEED = 'https://nsearchives.nseindia.com/content/RSS/Online_announcements.xml';
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
let lastPoll = 0;
export const feedState = { lastPoll: 0, lastCount: 0, error: null };

const decode = (s) => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
const tag = (item, t) => decode(item.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1] || '');

function parseIst(s) { // "14-Nov-2026 14:17:53" in IST
  const m = s.match(/(\d{2})-(\w{3})-(\d{4}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return NaN;
  return Date.UTC(+m[3], MONTHS[m[2]], +m[1], +m[4], +m[5], +m[6]) - 5.5 * 3600 * 1000;
}

export function parseFeed(xml) {
  return (xml.match(/<item>[\s\S]*?<\/item>/g) || []).map((item) => {
    const company = tag(item, 'title');
    const url = tag(item, 'link');
    const [body, subject] = tag(item, 'description').split('|SUBJECT:');
    return {
      _id: sha(url),
      src: 'NSE',
      company,
      nameNorm: normName(company),
      ticker: url.match(/\/corporate\/(?:xbrl\/)?([A-Z][A-Z0-9&-]*?)_\d/)?.[1] || null,
      title: (subject || '').trim() || 'Announcement',
      summary: body.trim(),
      url,
      ts: parseIst(tag(item, 'pubDate')),
    };
  }).filter((f) => f.url && Number.isFinite(f.ts));
}

export async function pollNse(force = false) {
  if (!force && Date.now() - lastPoll < 4 * 60 * 1000) return;
  lastPoll = Date.now();
  try {
    const items = parseFeed(await get(FEED, { timeout: 30000 }));
    await upsertFilings(items);
    Object.assign(feedState, { lastPoll, lastCount: items.length, error: null });
  } catch (e) {
    feedState.error = e.message;
  }
}

/** A company's own latest announcements (BSE, via Screener) backfill what the feed missed. */
export async function backfill(c) {
  await upsertFilings((c.announcements || []).map((a) => ({
    _id: sha(a.url), src: 'BSE', company: c.name, nameNorm: c.nameNorm, ticker: c.ticker,
    title: a.title.replace(/^Announcement under Regulation 30 \(LODR\)-/i, ''), summary: a.summary, url: a.url, ts: a.ts,
  })));
}
