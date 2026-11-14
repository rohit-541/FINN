// Primary documents: fetch a filed PDF once, keep its text for good, and hand the model
// only the passages that can answer the question. Selection is keyword scoring, not
// embeddings: it costs nothing and a concall's guidance is easy to spot by its vocabulary.
import { get } from './sources/http.js';
import { cached } from './store.js';

const MAX_BYTES = 45 * 1024 * 1024;

/** Text of a filing, one string per page. Cached for ever: a filed document never changes. */
export function pages(url) {
  return cached(`doc:${url}`, Infinity, async () => {
    const buf = await get(url, { as: 'buffer', timeout: 90000, concurrency: 2 });
    if (buf.byteLength > MAX_BYTES) throw new Error('document too large');
    if (String.fromCharCode(...buf.slice(0, 5)) !== '%PDF-') {
      // XBRL or HTML attachment: strip the markup and treat it as a single page
      return [new TextDecoder().decode(buf).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 60000)];
    }
    const { getDocumentProxy, extractText } = await import('unpdf');
    const pdf = await getDocumentProxy(buf);
    const { text } = await extractText(pdf, { mergePages: false });
    return text.map((p) => p.replace(/[ \t]+/g, ' ').trim());
  });
}

export const GUIDANCE_TERMS = [
  'guidance', 'guide', 'guided', 'expect', 'target', 'outlook', 'aspir', 'going forward', 'next year', 'next quarter',
  'margin', 'growth', 'grow', 'capex', 'ebitda', 'revenue', 'volume', 'order book', 'pipeline', 'demand', 'pricing',
  'confident', 'maintain', 'double', 'by fy', 'fy2', 'h2', 'full year', 'run rate', 'debt', 'cash flow', 'working capital',
];

/**
 * Keep the highest-scoring chunks, in their original order, up to a character budget.
 * A chunk scores for each term it contains, with a bonus for carrying a number or a percent.
 */
export function select(pageTexts, terms, budget, chunkSize = 1400) {
  const chunks = [];
  pageTexts.forEach((p, pi) => {
    for (let i = 0; i < p.length; i += chunkSize) chunks.push({ page: pi + 1, text: p.slice(i, i + chunkSize) });
  });
  for (const c of chunks) {
    const t = c.text.toLowerCase();
    c.score = terms.reduce((s, term) => s + (t.includes(term) ? 1 : 0), 0) + (/\d+(\.\d+)?\s?%/.test(t) ? 2 : 0) + (/\d/.test(t) ? 0.5 : 0);
  }
  const keep = new Set();
  let used = 0;
  for (const c of [...chunks].sort((a, b) => b.score - a.score)) {
    if (used + c.text.length > budget || c.score <= 0) continue;
    keep.add(c); used += c.text.length;
  }
  return chunks.filter((c) => keep.has(c)).map((c) => `[p.${c.page}] ${c.text}`).join('\n');
}
