import { useCallback, useEffect, useRef, useState } from 'react';

// ---------- API ----------
const BASE = import.meta.env.VITE_API_URL || '';

// The access code is kept on this device and sent with every API call. A 401 means it is
// missing, wrong or was changed on the server, so the app returns to its lock screen.
const CODE_KEY = 'finn.code';
export const accessCode = {
  get: () => { try { return localStorage.getItem(CODE_KEY) || ''; } catch { return ''; } },
  set: (c) => { try { if (c) localStorage.setItem(CODE_KEY, c); else localStorage.removeItem(CODE_KEY); } catch { /* private mode */ } },
};

async function call(path, opts = {}) {
  const res = await fetch(BASE + path, { ...opts, headers: { ...opts.headers, 'X-Finn-Code': accessCode.get() } });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/unlock') window.dispatchEvent(new Event('finn-locked'));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}
const post = (path, body) => call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const api = {
  access: () => call('/api/access'),
  unlock: (code) => post('/api/unlock', { code }),
  meta: () => call('/api/meta'),
  digest: (tickers, from, to) => call(`/api/digest?tickers=${tickers.join(',')}&from=${from}&to=${to}`),
  market: (tickers) => call(`/api/market?tickers=${tickers.join(',')}`),
  enrich: (item, read = false) => post('/api/enrich', { id: item.id, ticker: item.ticker, read }),
  search: (q) => call(`/api/search?q=${encodeURIComponent(q)}`),
  facts: (t) => call(`/api/research/${encodeURIComponent(t)}`),
  analysis: (t) => call(`/api/research/${encodeURIComponent(t)}/analysis`),
  ask: (t, question) => post(`/api/research/${encodeURIComponent(t)}/ask`, { question }),
};

// ---------- hooks ----------
export function useLocal(key, initial) {
  const [value, setValue] = useState(() => {
    try { const raw = localStorage.getItem(key); return raw == null ? initial : JSON.parse(raw); } catch { return initial; }
  });
  const set = useCallback((next) => setValue((prev) => {
    const v = typeof next === 'function' ? next(prev) : next;
    try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ }
    return v;
  }), [key]);
  return [value, set];
}

/** Load on mount and when deps change; keep showing the last good data while refreshing. */
export function useAsync(fn, deps, { refreshMs } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const run = useRef(0);
  const load = useCallback(() => {
    const id = ++run.current;
    setState((s) => ({ ...s, loading: true }));
    fn().then(
      (data) => id === run.current && setState({ data, error: null, loading: false }),
      (error) => id === run.current && setState((s) => ({ data: s.data, error: error.message, loading: false })),
    );
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
    if (!refreshMs) return undefined;
    const t = setInterval(() => document.visibilityState === 'visible' && load(), refreshMs);
    return () => clearInterval(t);
  }, [load, refreshMs]);
  return { ...state, reload: load };
}

// ---------- formatting ----------
const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const inr1 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
export const num = (v) => (v == null ? '–' : inr.format(v));
export const cr = (v) => {
  if (v == null) return '–';
  const a = Math.abs(v);
  if (a >= 1e5) return `₹${inr1.format(v / 1e5)} L Cr`;
  return `₹${inr.format(v)} Cr`;
};
export const price = (v) => (v == null ? '–' : `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: v < 1000 ? 1 : 0 }).format(v)}`);
export const pct = (v, digits = 1) => (v == null ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}%`);
export const dir = (v) => (v == null || Math.abs(v) < 0.05 ? 'flat' : v > 0 ? 'up' : 'down');
export const fy = (period) => {
  const m = String(period).match(/^(\w{3}) (\d{4})$/);
  if (!m) return period;
  return m[1] === 'Mar' ? `FY${m[2].slice(2)}` : `${m[1]} ${m[2].slice(2)}`;
};

export function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 60) return `${Math.max(m, 1)}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
export const dayLabel = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

// ---------- user rules ----------
export const DEFAULT_RULES = { price: 3, volume: 2, categories: {}, notify: false };
/** A category the investor marked "always" is material; "mute" is routine; otherwise FINN decides. */
export const tierOf = (item, rules) => {
  const o = rules.categories?.[item.category];
  return o === 'always' ? 3 : o === 'mute' ? 1 : item.tier;
};
export function moveOf(q, rules) {
  const byPrice = Math.abs(q.changePct) >= rules.price;
  const byVolume = q.volumeRatio != null && q.volumeRatio >= rules.volume;
  if (!byPrice && !byVolume) return null;
  const way = q.changePct >= 0 ? 'Up' : 'Down';
  const p = `${way} ${Math.abs(q.changePct).toFixed(1)}%`;
  const v = `${q.volumeRatio?.toFixed(1)}× its usual volume`;
  return {
    text: byPrice && byVolume ? `${p} on ${v}` : byPrice ? p : `${v}, price ${pct(q.changePct)}`,
    weight: Math.abs(q.changePct) / rules.price + (q.volumeRatio || 0) / rules.volume,
  };
}

// Links that come from scraped pages are only rendered when they are plain http(s), never javascript: or data:.
export const safeUrl = (u) => { try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : undefined; } catch { return undefined; } };
