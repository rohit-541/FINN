// One polite HTTP helper: an honest client name, a timeout, and a small concurrency gate per host.
const UA = 'finn-prototype/0.1';
const gates = new Map();

function gate(host, max) {
  if (!gates.has(host)) gates.set(host, { active: 0, queue: [] });
  const g = gates.get(host);
  return new Promise((resolve) => {
    const run = () => { g.active++; resolve(() => { g.active--; g.queue.shift()?.(); }); };
    g.active < max ? run() : g.queue.push(run);
  });
}

export async function get(url, { as = 'text', timeout = 25000, concurrency = 3 } = {}) {
  const release = await gate(new URL(url).host, concurrency);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: '*/*' },
      signal: AbortSignal.timeout(timeout),
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
    if (as === 'json') return await res.json();
    if (as === 'buffer') return new Uint8Array(await res.arrayBuffer());
    return await res.text();
  } finally {
    release();
  }
}

export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); } catch (e) { out[idx] = { error: e.message }; }
    }
  }));
  return out;
}
