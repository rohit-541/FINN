// screener.in: standardised financials, document links (annual reports, concall transcripts)
// and each company's latest exchange announcements. One page fetch per company, cached.
import * as cheerio from 'cheerio';
import { get } from './http.js';
import { cached } from '../store.js';

const BASE = 'https://www.screener.in';
const PAGE_TTL = 30 * 60 * 1000;

export const normName = (s) =>
  String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '').replace(/(limited|ltd)$/, '');

const num = (s) => {
  const v = parseFloat(String(s).replace(/[,%₹\s]/g, ''));
  return Number.isFinite(v) ? v : null;
};
const clean = (s) => String(s).replace(/ /g, ' ').replace(/\s+/g, ' ').replace(/\s*\+\s*$/, '').replace(/''/g, "'").trim();

function table($, id) {
  const t = $(`#${id} table.data-table`).first();
  const cols = t.find('thead th').slice(1).map((_, th) => clean($(th).text())).get();
  const rows = {};
  t.find('tbody tr').each((_, tr) => {
    const tds = $(tr).find('td');
    const label = clean(tds.first().text());
    if (!label) return;
    rows[label] = tds.slice(1).map((_, td) => num($(td).text())).get();
  });
  return { cols, rows };
}

function parse(html, ticker) {
  const $ = cheerio.load(html);
  const name = clean($('h1').first().text());
  if (!name) throw new Error(`No company page for ${ticker}`);
  const links = clean($('.company-links').text());
  const ratios = {};
  $('#top-ratios li').each((_, li) => {
    const k = clean($(li).find('.name').text());
    const nums = $(li).find('.number').map((_, n) => num($(n).text())).get();
    ratios[k] = nums.length > 1 ? nums : nums[0] ?? null;
  });
  const announcements = $('#company-announcements-tab ul.list-links li a').map((_, a) => {
    const $a = $(a);
    const detail = clean($a.find('div').text());
    const title = clean($a.clone().children().remove().end().text());
    const ts = Date.parse($a.find('time').attr('datetime') || '');
    return { title, summary: detail.replace(/^[^-]*-\s*/, ''), url: $a.attr('href'), ts };
  }).get().filter((a) => a.url && Number.isFinite(a.ts));

  const annualReports = $('.documents.annual-reports ul.list-links li a').map((_, a) => ({
    title: clean($(a).clone().children().remove().end().text()), url: $(a).attr('href'),
  })).get().filter((d) => /annual|report/i.test(d.title));

  const concalls = $('.documents.concalls ul.list-links li').map((_, li) => {
    const $li = $(li);
    const link = (label) => $li.find('a').filter((_, a) => clean($(a).text()) === label).attr('href') || null;
    return { period: clean($li.children('div').first().text()), transcript: link('Transcript'), ppt: link('PPT') };
  }).get().filter((c) => c.period);

  return {
    ticker,
    id: $('#company-info').attr('data-company-id') || html.match(/data-company-id="(\d+)"/)?.[1] || null,
    name,
    nameNorm: normName(name),
    about: clean($('.company-profile .about').first().text()),
    nse: links.match(/NSE\s*:\s*([A-Z0-9&-]+)/)?.[1] || null,
    bse: links.match(/BSE\s*:\s*(\d+)/)?.[1] || null,
    ratios,
    quarters: table($, 'quarters'),
    pl: table($, 'profit-loss'),
    bs: table($, 'balance-sheet'),
    cf: table($, 'cash-flow'),
    eff: table($, 'ratios'),
    docs: { annualReports, concalls },
    announcements,
  };
}

/** Consolidated numbers when the company reports them, standalone otherwise. */
export function company(ticker) {
  const t = ticker.toUpperCase().replace(/[^A-Z0-9&-]/g, '');
  return cached(`screener:${t}`, PAGE_TTL, async () => {
    let c = parse(await get(`${BASE}/company/${encodeURIComponent(t)}/consolidated/`), t);
    c.view = 'consolidated';
    if (!c.quarters.cols.length) {
      c = parse(await get(`${BASE}/company/${encodeURIComponent(t)}/`), t);
      c.view = 'standalone';
    }
    return c;
  });
}

export function search(q) {
  return cached(`search:${q.toLowerCase()}`, 24 * 3600 * 1000, async () => {
    const rows = await get(`${BASE}/api/company/search/?q=${encodeURIComponent(q)}`, { as: 'json' });
    return rows
      .map((r) => ({ name: r.name, ticker: r.url?.match(/\/company\/([^/]+)\//)?.[1] }))
      .filter((r) => r.ticker)
      .slice(0, 8);
  });
}

/** Daily close and volume from Screener's chart endpoint: the fallback price source. */
export async function chart(id, days = 200) {
  const d = await get(`${BASE}/api/company/${id}/chart/?q=Price-Volume&days=${days}`, { as: 'json' });
  const price = d.datasets.find((x) => x.metric === 'Price')?.values || [];
  const vol = new Map((d.datasets.find((x) => x.metric === 'Volume')?.values || []).map((v) => [v[0], v[1]]));
  return price.map(([date, close]) => ({ date, close: +close, volume: vol.get(date) ?? null }));
}
