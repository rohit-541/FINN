// Pull: on-demand research on any ticker Screener knows.
// facts()    - every number and verdict that can be computed, no model, instant.
// analysis() - what management said (fast model, one pass per document, cached for good)
//              set against what the numbers did (one smart-model pass).
// ask()      - a question answered from the documents, with quotes.
import { company } from './sources/screener.js';
import { quote } from './sources/prices.js';
import { pages, select, GUIDANCE_TERMS } from './docs.js';
import { llmJson, llmInfo } from './llm.js';
import { cached, peek, sha } from './store.js';

const pick = (rows, ...names) => names.map((n) => rows[n]).find(Boolean) || [];
const series = (t, ...names) => t.cols.map((period, i) => ({ period, v: pick(t.rows, ...names)[i] ?? null }));
const last = (s, back = 0) => s.filter((p) => p.v != null).at(-1 - back) ?? null;
const cagr = (s, years) => {
  const pts = s.filter((p) => p.v != null);
  const a = pts.at(-1 - years)?.v, b = pts.at(-1)?.v;
  return a > 0 && b > 0 ? (Math.pow(b / a, 1 / years) - 1) * 100 : null;
};
const sum = (s, n) => s.filter((p) => p.v != null).slice(-n).reduce((x, p) => x + p.v, 0);
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

export async function facts(ticker) {
  const c = await company(ticker);
  const px = await quote(c).catch(() => null);
  const annual = (s) => s.filter((p) => p.period !== 'TTM');
  const financial = !!c.pl.rows['Financing Profit'] || !!c.bs.rows['Deposits'];

  const revenue = series(c.pl, 'Sales', 'Revenue');
  const op = series(c.pl, 'Operating Profit', 'Financing Profit');
  const opm = series(c.pl, 'OPM %', 'Financing Margin %');
  const pat = series(c.pl, 'Net Profit');
  const borrow = series(c.bs, 'Borrowings', 'Borrowing');
  const equity = c.bs.cols.map((period, i) => {
    const e = c.bs.rows['Equity Capital']?.[i], r = c.bs.rows['Reserves']?.[i];
    return { period, v: e != null && r != null ? e + r : null };
  });
  const de = equity.map((e, i) => ({ period: e.period, v: e.v > 0 && borrow[i]?.v != null ? Math.round((borrow[i].v / e.v) * 100) / 100 : null }));
  const cfo = series(c.cf, 'Cash from Operating Activity');
  const fcf = series(c.cf, 'Free Cash Flow');
  const ccc = series(c.eff, 'Cash Conversion Cycle');
  const roce = series(c.eff, 'ROCE %');
  const patAnnual = annual(pat);
  const conv5 = sum(patAnnual, 5) > 0 ? (sum(cfo, 5) / sum(patAnnual, 5)) * 100 : null;

  const q = c.quarters;
  const qRows = q.cols.map((period, i) => {
    const rev = pick(q.rows, 'Sales', 'Revenue'), np = q.rows['Net Profit'] || [];
    const yoy = (v) => (v[i] != null && v[i - 4] > 0 ? r1((v[i] / v[i - 4] - 1) * 100) : null);
    return {
      period, revenue: rev[i] ?? null, revenueYoy: yoy(rev), op: pick(q.rows, 'Operating Profit', 'Financing Profit')[i] ?? null,
      opm: pick(q.rows, 'OPM %', 'Financing Margin %')[i] ?? null, pbt: q.rows['Profit before tax']?.[i] ?? null, pat: np[i] ?? null, patYoy: yoy(np),
    };
  }).slice(-8);

  // Verdicts a model is not needed for.
  const signals = [];
  const say = (tone, text) => signals.push({ tone, text });
  const g3 = cagr(annual(revenue), 3), g5 = cagr(annual(revenue), 5), p3 = cagr(patAnnual, 3);
  if (g3 != null && g5 != null) {
    say(g3 >= g5 + 2 ? 'good' : g3 <= g5 - 2 ? 'warn' : 'neutral',
      `Revenue grew ${r1(g3)}% a year over 3 years against ${r1(g5)}% over 5: ${g3 >= g5 + 2 ? 'accelerating' : g3 <= g5 - 2 ? 'slowing' : 'steady'}.`);
  }
  if (g3 != null && p3 != null) {
    say(p3 >= g3 ? 'good' : 'warn', `Profit grew ${r1(p3)}% a year over 3 years, ${p3 >= g3 ? 'faster' : 'slower'} than revenue.`);
  }
  const mNow = last(opm), mThen = last(annual(opm), 3);
  if (!financial && mNow && mThen) {
    const d = mNow.v - mThen.v;
    say(d >= 1 ? 'good' : d <= -1 ? 'bad' : 'neutral',
      `${financial ? 'Financing' : 'Operating'} margin is ${mNow.v}% now against ${mThen.v}% in ${mThen.period}: ${d >= 1 ? 'expanding' : d <= -1 ? 'compressing' : 'flat'}.`);
  }
  if (!financial) {
    const dNow = last(de), dThen = last(de, 3);
    if (dNow) say(dNow.v < 0.5 ? 'good' : dNow.v < 1.5 ? 'neutral' : 'bad',
      `Debt is ${dNow.v}× equity${dThen ? `, from ${dThen.v}× in ${dThen.period}` : ''}.`);
    if (conv5 != null) say(conv5 >= 90 ? 'good' : conv5 >= 60 ? 'warn' : 'bad',
      `Over 5 years, ₹100 of profit came with ₹${Math.round(conv5)} of operating cash.`);
    const cNow = last(ccc), cThen = last(ccc, 3);
    if (cNow && cThen) {
      const d = cNow.v - cThen.v;
      say(d > 15 ? 'warn' : d < -15 ? 'good' : 'neutral',
        `Cash conversion cycle is ${cNow.v} days against ${cThen.v} in ${cThen.period}${d > 15 ? ': more cash is tied up' : d < -15 ? ': cash is freed up' : ''}.`);
    }
  }
  const rNow = last(roce);
  if (financial && c.ratios.ROE != null) say(c.ratios.ROE >= 15 ? 'good' : c.ratios.ROE >= 10 ? 'neutral' : 'warn', `Return on equity is ${c.ratios.ROE}%.`);
  else if (rNow) say(rNow.v >= 18 ? 'good' : rNow.v >= 10 ? 'neutral' : 'warn', `Return on capital employed was ${rNow.v}% in ${rNow.period}.`);

  return {
    ticker: c.ticker, name: c.name, about: c.about, view: c.view, financial,
    price: px, ratios: c.ratios,
    ttm: { revenue: last(revenue)?.v, op: last(op)?.v, opm: last(opm)?.v, pat: last(pat)?.v },
    growth: { revenue3: r1(g3), revenue5: r1(g5), revenue10: r1(cagr(annual(revenue), 10)), pat3: r1(p3), pat5: r1(cagr(patAnnual, 5)) },
    annual: { revenue: annual(revenue), op: annual(op), opm: annual(opm), pat: patAnnual },
    balance: { borrowings: borrow, equity, de, ccc, roce, debtorDays: series(c.eff, 'Debtor Days'), inventoryDays: series(c.eff, 'Inventory Days'), payableDays: series(c.eff, 'Days Payable') },
    cash: { cfo, fcf, pat: patAnnual, conversion5: r1(conv5) },
    quarters: qRows,
    signals,
    docs: { annualReports: c.docs.annualReports.slice(0, 3), concalls: c.docs.concalls.slice(0, 6) },
    llm: llmInfo().enabled,
  };
}

// ---------- analysis ----------
const jobs = new Map();
const GROUND = 'Use only the material given in this message. Do not use anything you know about the company from elsewhere. If the material does not say, leave the field empty.';

function numbersText(f) {
  const q = f.quarters.map((r) => `${r.period}: revenue ${r.revenue} (YoY ${r.revenueYoy ?? 'n/a'}%), operating margin ${r.opm}%, PAT ${r.pat} (YoY ${r.patYoy ?? 'n/a'}%)`).join('\n');
  const a = f.annual.revenue.slice(-5).map((p, i) => {
    const k = f.annual.revenue.length - Math.min(5, f.annual.revenue.length) + i;
    return `${p.period}: revenue ${p.v}, operating margin ${f.annual.opm[k]?.v}%, PAT ${f.annual.pat[k]?.v}`;
  }).join('\n');
  const b = `Borrowings ${last(f.balance.borrowings)?.v}, debt/equity ${last(f.balance.de)?.v}, 5-year cash conversion ${f.cash.conversion5}%, cash conversion cycle ${last(f.balance.ccc)?.v} days, ROCE ${last(f.balance.roce)?.v}%`;
  return `QUARTERLY (₹ Cr, ${f.view})\n${q}\n\nANNUAL\n${a}\n\nLATEST\n${b}`;
}

async function readCall(name, call) {
  const text = select(await pages(call.transcript), GUIDANCE_TERMS, 22000);
  if (text.length < 500) return null;
  const out = await llmJson({
    tier: 'fast',
    system: `You extract what management committed to on an earnings call. Quote exactly. ${GROUND}`,
    user: `Company: ${name}. Call held: ${call.period}.\nExcerpts, tagged with page numbers:\n${text}\n\nReturn {"quarter_discussed":"","guidance":[{"metric":"revenue growth|margin|capex|volume|debt|other","statement":"what was guided, 20 words at most","target":"the number or range as said","horizon":"by when","quote":"30 words at most, verbatim","page":0}],"claims":[{"theme":"","claim":"a growth or outlook claim, 20 words at most","quote":"","page":0}],"analyst_pressure":["what analysts pushed on, 15 words at most"]}. At most 6 guidance, 5 claims, 3 analyst_pressure. Only forward-looking, checkable statements count as guidance.`,
    maxTokens: 1800,
  });
  return { call: `${call.period} call`, url: call.transcript, ...out };
}

async function readAnnualReport(name, ar) {
  const text = select(await pages(ar.url),
    ['segment', 'revenue mix', 'business overview', 'management discussion', 'our business', 'products', 'market share', 'geograph', 'export', 'customers', 'capacity', '% of revenue', 'contribut', 'verticals'],
    18000);
  if (text.length < 500) return null;
  const out = await llmJson({
    tier: 'fast',
    system: `You describe a business from its own annual report. ${GROUND}`,
    user: `Company: ${name}. ${ar.title}.\nExcerpts, tagged with page numbers:\n${text}\n\nReturn {"what_it_does":"40 words at most, plain","segments":[{"name":"","share_pct":null,"note":"12 words at most"}],"geography":"20 words at most or ''","position":"what the company says about its market position, 25 words at most, or ''"}. share_pct is the share of revenue as a number when the report states it, else null. At most 6 segments.`,
    maxTokens: 900,
  });
  return { source: ar.title, url: ar.url, ...out };
}

async function runAnalysis(ticker, job) {
  const f = await facts(ticker);
  const c = await company(ticker);
  const calls = c.docs.concalls.filter((x) => x.transcript).slice(0, 4);
  const ar = c.docs.annualReports[0];
  const key = `analysis:${c.ticker}:${sha((calls[0]?.transcript || '') + (ar?.url || '') + f.quarters.at(-1)?.period)}`;
  const done = await peek(key);
  if (done) return done;

  const read = [];
  for (const [i, call] of calls.reverse().entries()) { // oldest first, one at a time: kind to free tiers
    job.stage = `Reading the ${call.period} call (${i + 1} of ${calls.length})`;
    try { const r = await readCall(c.name, call); if (r) read.push(r); } catch (e) { job.warnings.push(`${call.period} call: ${e.message}`); }
  }
  let business = null;
  if (ar) {
    job.stage = `Reading ${ar.title}`;
    try { business = await readAnnualReport(c.name, ar); } catch (e) { job.warnings.push(`${ar.title}: ${e.message}`); }
  }
  if (!read.length && !business) throw new Error('No transcript or annual report could be read for this company.');

  job.stage = 'Checking what was said against the numbers';
  const verdict = read.length ? await llmJson({
    tier: 'smart',
    system: `You are an equity analyst testing management's word against reported numbers. Be specific and unsentimental. Cite figures. ${GROUND}`,
    user: `Company: ${c.name}\n\nREPORTED NUMBERS\n${numbersText(f)}\n\nWHAT MANAGEMENT SAID (extracted from call transcripts, oldest first)\n${JSON.stringify(read.map(({ url, ...r }) => r))}\n\nReturn {"credibility":{"rating":"high|mixed|low","line":"25 words at most on how well delivery has matched guidance"},"promises":[{"said_in":"which call","promise":"18 words at most","target":"","delivered":"what the reported numbers show since, with figures","verdict":"delivered|partly|missed|too_early","quote":"the verbatim quote from the extraction"}],"agree":["where the story and the numbers match, 20 words at most"],"diverge":["where they do not, 20 words at most"],"guidance_now":[{"metric":"","target":"","horizon":"","said_in":""}],"bull":["20 words at most"],"bear":["20 words at most"]}. At most 6 promises, favouring ones the quarterly numbers can test; verdict too_early when they cannot yet. guidance_now is what still stands from the latest call. Exactly 3 bull and 3 bear points, each resting on a number or a quote above.`,
    maxTokens: 2600,
  }) : null;

  const result = { business, calls: read, verdict, warnings: job.warnings, at: Date.now() };
  await cached(key, 0, async () => result);
  return result;
}

export function analysis(ticker) {
  const t = ticker.toUpperCase();
  if (!llmInfo().enabled) return { status: 'no_llm' };
  let job = jobs.get(t);
  if (!job || (job.status === 'error' && Date.now() - job.at > 15000)) {
    job = { status: 'running', stage: 'Finding the documents', warnings: [], at: Date.now() };
    jobs.set(t, job);
    runAnalysis(t, job)
      .then((data) => Object.assign(job, { status: 'done', data }))
      .catch((e) => Object.assign(job, { status: 'error', error: e.message, at: Date.now() }));
  }
  return job;
}

export async function ask(ticker, question) {
  if (!llmInfo().enabled) return { needsKey: true };
  const f = await facts(ticker);
  const c = await company(ticker);
  const terms = question.toLowerCase().split(/[^a-z0-9%]+/).filter((w) => w.length > 3);
  const docs = [];
  for (const call of c.docs.concalls.filter((x) => x.transcript).slice(0, 2)) {
    try { docs.push(`## ${call.period} call\n${select(await pages(call.transcript), terms.length ? terms : GUIDANCE_TERMS, 9000)}`); } catch { /* skip unreadable */ }
  }
  const out = await llmJson({
    tier: 'fast',
    system: `You answer an investor's question about one company from its own filings. Short, exact, no advice. ${GROUND}`,
    user: `Company: ${c.name}\n\n${numbersText(f)}\n\n${docs.join('\n\n')}\n\nQuestion: ${question}\n\nReturn {"answer":"70 words at most","sources":[{"doc":"which call, or 'Reported numbers'","page":0,"quote":"25 words at most, verbatim"}],"not_in_sources":false}. Set not_in_sources true and say so in the answer when the material does not cover the question.`,
    maxTokens: 700,
  });
  return out;
}
