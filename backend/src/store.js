// Storage with two interchangeable backends: MongoDB when MONGODB_URI is set and
// reachable, JSON files under backend/data otherwise. The app never needs to know which.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// On Vercel only /tmp is writable, and it is not shared between instances: set MONGODB_URI there.
const DIR = process.env.DATA_DIR
  || (process.env.VERCEL ? '/tmp/finn-data' : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data'));
const CACHE_DIR = path.join(DIR, 'cache');
const FILINGS_FILE = path.join(DIR, 'filings.json');

let db = null;
let filings = new Map(); // file mode only
let flushTimer = null;
const inflight = new Map();
const mem = new Map(); // small hot cache in front of either backend

export const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');
export let storeMode = 'file';

export async function initStore() {
  const uri = process.env.MONGODB_URI;
  if (uri) {
    try {
      const { MongoClient } = await import('mongodb');
      const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
      await client.connect();
      db = client.db(process.env.MONGODB_DB || 'finn');
      await db.collection('filings').createIndex({ ts: -1 });
      await db.collection('filings').createIndex({ ticker: 1, ts: -1 });
      await db.collection('filings').createIndex({ nameNorm: 1, ts: -1 });
      storeMode = 'mongo';
    } catch (e) {
      console.warn(`[store] MongoDB unreachable (${e.message}); using JSON files`);
      db = null;
    }
  }
  if (!db) {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    try {
      const rows = JSON.parse(await fs.readFile(FILINGS_FILE, 'utf8'));
      filings = new Map(rows.map((r) => [r._id, r]));
    } catch { /* first run */ }
  }
  console.log(`[store] ${storeMode}`);
  if (process.env.VERCEL && !db) console.warn('[store] On Vercel without MongoDB: data lives in /tmp and is lost between instances. Set MONGODB_URI.');
}

// ---------- key/value cache ----------
async function kvGet(key) {
  if (mem.has(key)) return mem.get(key);
  let row = null;
  if (db) row = await db.collection('cache').findOne({ _id: key });
  else {
    try { row = JSON.parse(await fs.readFile(path.join(CACHE_DIR, sha(key) + '.json'), 'utf8')); } catch { row = null; }
  }
  if (row) remember(key, row);
  return row;
}

function remember(key, row) {
  mem.set(key, row);
  if (mem.size > 400) mem.delete(mem.keys().next().value);
}

async function kvSet(key, value) {
  const row = { _id: key, at: Date.now(), value };
  remember(key, row);
  if (db) await db.collection('cache').replaceOne({ _id: key }, row, { upsert: true });
  else await fs.writeFile(path.join(CACHE_DIR, sha(key) + '.json'), JSON.stringify(row));
}

/**
 * Read-through cache. ttlMs = Infinity for immutable things (a filed PDF never changes).
 * If the refresh fails and a stale copy exists, the stale copy is served.
 */
export async function cached(key, ttlMs, fn, onHit) {
  const row = await kvGet(key);
  if (row && Date.now() - row.at < ttlMs) { onHit?.(); return row.value; }
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const value = await fn();
      if (value !== undefined) await kvSet(key, value);
      return value;
    } catch (e) {
      if (row) return row.value;
      throw e;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

export const peek = async (key) => (await kvGet(key))?.value;

// ---------- filings ----------
export async function upsertFilings(list) {
  if (!list.length) return;
  if (db) {
    await db.collection('filings').bulkWrite(
      list.map((f) => ({ updateOne: { filter: { _id: f._id }, update: { $setOnInsert: f }, upsert: true } })),
      { ordered: false },
    );
    return;
  }
  let added = 0;
  for (const f of list) if (!filings.has(f._id)) { filings.set(f._id, f); added++; }
  if (added) {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(async () => {
      const cutoff = Date.now() - 60 * 864e5; // keep two months
      for (const [id, f] of filings) if (f.ts < cutoff) filings.delete(id);
      await fs.writeFile(FILINGS_FILE, JSON.stringify([...filings.values()]));
    }, 500);
  }
}

/** One stored filing by id, or null. */
export async function getFiling(id) {
  if (typeof id !== 'string' || id.length > 200) return null;
  if (db) return db.collection('filings').findOne({ _id: id });
  return filings.get(id) || null;
}

/** Filings in [from, to] that belong to any of the given companies ({ticker, nameNorm}). */
export async function findFilings({ companies, from, to }) {
  const tickers = companies.flatMap((c) => [c.ticker, c.nse]).filter(Boolean);
  const names = companies.map((c) => c.nameNorm);
  if (db) {
    return db.collection('filings')
      .find({ ts: { $gte: from, $lte: to }, $or: [{ ticker: { $in: tickers } }, { nameNorm: { $in: names } }] })
      .sort({ ts: -1 }).limit(2000).toArray();
  }
  const t = new Set(tickers), n = new Set(names);
  return [...filings.values()]
    .filter((f) => f.ts >= from && f.ts <= to && (t.has(f.ticker) || n.has(f.nameNorm)))
    .sort((a, b) => b.ts - a.ts);
}
