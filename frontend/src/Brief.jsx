import { useEffect, useMemo, useState } from 'react';
import { api, useAsync, useLocal, ago, num, pct, dir, price, tierOf, moveOf } from './lib.js';
import { Spark } from './Charts.jsx';

const DAY = 864e5;
const WINDOWS = [
  { id: '24h', n: '24', u: 'hours', ms: DAY, words: 'the last 24 hours' },
  { id: '3d', n: '3', u: 'days', ms: 3 * DAY, words: 'the last 3 days' },
  { id: '7d', n: '7', u: 'days', ms: 7 * DAY, words: 'the last 7 days' },
  { id: '30d', n: '30', u: 'days', ms: 30 * DAY, words: 'the last 30 days' },
];
const iso = (ts) => new Date(ts).toISOString().slice(0, 10);

function Delta({ v, digits = 1 }) {
  return <span className={`delta ${dir(v)}`}>{v == null ? '–' : <>{dir(v) === 'up' ? '▲' : dir(v) === 'down' ? '▼' : ''} {pct(v, digits).replace(/^[+−]/, '')}</>}</span>;
}

function ResultsTable({ r }) {
  return (
    <div className="results">
      <div className="results-head">
        <span>{r.period} quarter · {r.unit} · {r.view}</span>
        {r.margin && <span>Margin {r.margin.now}%{r.margin.yoyPts != null && ` (${r.margin.yoyPts > 0 ? '+' : ''}${r.margin.yoyPts} pts YoY)`}</span>}
      </div>
      <table>
        <thead><tr><th scope="col"><span className="sr">Line</span></th><th scope="col">{r.period}</th><th scope="col">QoQ</th><th scope="col">YoY</th></tr></thead>
        <tbody>
          {r.lines.map((l) => (
            <tr key={l.label}>
              <th scope="row">{l.label}</th>
              <td>{num(l.now)}</td>
              <td><Delta v={l.qoq} /></td>
              <td><Delta v={l.yoy} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {r.behind && <p className="fine">The standardised table has not caught up with this filing yet. These are the previous quarter's numbers.</p>}
    </div>
  );
}

function People({ data, company }) {
  return (
    <div className="people">
      {data.people.map((p) => (
        <div key={p.name} className="person">
          <div className="person-top">
            <strong>{p.name}</strong>
            <span className={`chip ${p.change === 'appointed' || p.change === 'reappointed' ? 'in' : 'out'}`}>{p.change}</span>
          </div>
          <div className="person-role">{p.role}{p.effective && ` · from ${p.effective}`}</div>
          {p.background && <p>{p.background}</p>}
          {p.reason && <p>Reason given: {p.reason}</p>}
          {p.previous?.length > 0 && <div className="person-prev">{p.previous.map((x) => <span key={x}>{x}</span>)}</div>}
          <a className="link" target="_blank" rel="noreferrer"
            href={`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${p.name} ${company.replace(/ Ltd\.?$/, '')}`)}`}>
            Find {p.name.split(' ')[0]} on LinkedIn
          </a>
        </div>
      ))}
    </div>
  );
}

function Filing({ item, material, embedded, onClear, go }) {
  const [extra, setExtra] = useState(null);
  const [reading, setReading] = useState(false);
  const auto = (material && item.category === 'results' && item.tier === 3) || item.category === 'management_change';
  useEffect(() => {
    let live = true;
    if (auto) api.enrich(item).then((r) => live && setExtra(r)).catch(() => {});
    return () => { live = false; };
  }, [item.id, auto]); // eslint-disable-line react-hooks/exhaustive-deps

  const read = () => {
    setReading(true);
    api.enrich(item, true).then((r) => setExtra((e) => ({ ...e, ...r }))).catch((e) => setExtra((x) => ({ ...x, briefError: e.message }))).finally(() => setReading(false));
  };

  const meta = (
    <div className="filing-meta">
      <button className="ticker" onClick={() => go('research', item.ticker)} aria-label={`Research ${item.company}`}>{item.ticker}</button>
      <span className="cat">{item.label}</span>
      <time>{ago(item.ts)}</time>
    </div>
  );
  const body = (
    <>
      {extra?.results && <ResultsTable r={extra.results} />}
      {extra?.people && <People data={extra.people} company={item.company} />}
      {extra?.brief && (
        <div className="take">
          <p>{extra.brief.what}</p>
          {extra.brief.why && <p className="why">{extra.brief.why}</p>}
          {extra.brief.numbers?.length > 0 && (
            <dl>{extra.brief.numbers.map((n) => <div key={n.label}><dt>{n.label}</dt><dd>{n.value}</dd></div>)}</dl>
          )}
        </div>
      )}
      {extra?.needsKey && <p className="fine">Reading a filing needs a model key on the backend. Rules, numbers and prices work without one.</p>}
      {extra?.briefError && <p className="fine">FINN could not read this filing: {extra.briefError}</p>}
      <div className="actions">
        <a className="btn ghost" href={item.url} target="_blank" rel="noreferrer">Open filing</a>
        {!extra?.brief && <button className="btn ghost" onClick={read} disabled={reading}>{reading ? 'Reading…' : 'Read it for me'}</button>}
        <button className="btn ghost end" onClick={() => onClear(item.id)}>Clear</button>
      </div>
      {item.related.length > 0 && (
        <details className="related">
          <summary>{item.related.length} more filing{item.related.length > 1 ? 's' : ''} on the same event</summary>
          {item.related.map((r) => <a key={r.id} href={r.url} target="_blank" rel="noreferrer">{r.src} · {r.title}</a>)}
        </details>
      )}
    </>
  );

  if (embedded) return <div className="filing embedded">{body}</div>;
  if (material) return <article className="card filing">{meta}<h3>{item.headline}</h3>{body}</article>;
  return (
    <details className="row filing">
      <summary>{meta}<span className="row-text">{item.headline}</span></summary>
      {body}
    </details>
  );
}

// How the whole portfolio closed: breadth, average move and the biggest movers either way.
// Shown every day, so a quiet day still says something.
function Pulse({ quotes, go, open, onToggle }) {
  const qs = quotes.filter((q) => q.changePct != null);
  if (!qs.length) return null;
  const up = qs.filter((q) => q.changePct > 0).length;
  const down = qs.filter((q) => q.changePct < 0).length;
  const avg = qs.reduce((a, q) => a + q.changePct, 0) / qs.length;
  const byMove = [...qs].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
  const list = open ? [...qs].sort((a, b) => b.changePct - a.changePct) : byMove.slice(0, 3);
  return (
    <section className="hold" aria-label="How your holdings closed">
      <div className="hold-head">
        <div>
          <span className="hold-k">Holdings, average move</span>
          <b className={`hold-v ${dir(avg)}`}>{pct(avg, 2)}</b>
        </div>
        <div className="hold-breadth">
          <span><i className="up">{up}</i> up</span>
          <span><i className="down">{down}</i> down</span>
        </div>
      </div>
      <div className="breadth" role="img" aria-label={`${up} up, ${down} down, ${qs.length - up - down} flat`}>
        <i className="up" style={{ flexGrow: up }} /><i className="flat" style={{ flexGrow: qs.length - up - down }} /><i className="down" style={{ flexGrow: down }} />
      </div>
      <div className="hold-list">
        {list.map((q) => (
          <button key={q.ticker} className="line" onClick={() => go('research', q.ticker)}>
            <span><b>{q.ticker}</b><small>{price(q.close)}{q.volumeRatio >= 1.5 ? ` · ${q.volumeRatio.toFixed(1)}× volume` : ''}</small></span>
            <span className="line-side"><Spark values={q.spark} /><Delta v={q.changePct} digits={2} /></span>
          </button>
        ))}
      </div>
      <button className="list-more" onClick={onToggle} aria-expanded={open}>{open ? 'Show the biggest three' : `All ${qs.length} holdings`}</button>
    </section>
  );
}

const short = (h) => (h.length > 90 ? `${h.slice(0, 88).replace(/\s\S*$/, '')}…` : h);
const Icon = ({ d }) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;
const CHECK = 'M5 12.5 10 17l9-10';
const ARROW = 'M7 17 17 7M9 7h8v8';

export default function Brief({ portfolio, rules, go }) {
  const [win, setWin] = useLocal('finn.window', { id: '24h' });
  const [cleared, setCleared] = useLocal('finn.cleared', []);
  const [open, setOpen] = useState(null); // one panel at a time: window | hero | pulse | moves | glance | more | routine
  const toggle = (k) => setOpen((o) => (o === k ? null : k));
  const preset = WINDOWS.find((w) => w.id === win.id);
  const key = portfolio.join(',');

  const digest = useAsync(() => {
    const to = preset ? Date.now() : Date.parse(`${win.to}T23:59:59+05:30`);
    const from = preset ? to - preset.ms : Date.parse(`${win.from}T00:00:00+05:30`);
    return api.digest(portfolio, from, to);
  }, [key, win.id, win.from, win.to], { refreshMs: 180000 });
  const mkt = useAsync(() => api.market(portfolio), [key], { refreshMs: 600000 });

  const d = digest.data;
  const { material, glance, routine } = useMemo(() => {
    const out = { material: [], glance: [], routine: [] };
    for (const it of d?.items || []) {
      if (cleared.includes(it.id)) continue;
      out[['routine', 'routine', 'glance', 'material'][tierOf(it, rules)]].push(it);
    }
    return out;
  }, [d, cleared, rules]);
  const moves = useMemo(() => (mkt.data || [])
    .map((q) => ({ q, m: moveOf(q, rules) })).filter((x) => x.m).sort((a, b) => b.m.weight - a.m.weight), [mkt.data, rules]);

  // Tell the investor once about each new material filing, if they asked to be told.
  useEffect(() => {
    if (!d || !rules.notify || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    let seen;
    try { seen = JSON.parse(localStorage.getItem('finn.notified') || 'null'); } catch { seen = null; }
    if (seen) material.filter((m) => !seen.includes(m.id)).slice(0, 3).forEach((m) => new Notification(`${m.ticker} · ${m.label}`, { body: m.headline }));
    try { localStorage.setItem('finn.notified', JSON.stringify([...new Set([...(seen || []), ...material.map((m) => m.id)])].slice(-300))); } catch { /* private mode */ }
  }, [d]); // eslint-disable-line react-hooks/exhaustive-deps

  const clear = (id) => { setCleared((c) => [...c, id].slice(-500)); setOpen(null); };
  const [top, ...rest] = material;
  const others = [...new Set(rest.map((m) => m.ticker))];
  const eod = mkt.data?.[0]?.date;
  const words = preset ? preset.words.replace(/^the l/, 'L') : `${win.from} to ${win.to}`;

  return (
    <>
      <header className="home-head">
        <div>
          <h1>Brief</h1>
          <p>{words}</p>
        </div>
        <button className="date-chip" onClick={() => toggle('window')} aria-expanded={open === 'window'} aria-label={`Time window: ${words}. Change`}>
          <b>{preset ? preset.n : '··'}</b><small>{preset ? preset.u : 'dates'}</small>
          {material.length > 0 && <i className="dot" />}
        </button>
      </header>

      {open === 'window' && (
        <div className="pop">
          <div className="pop-row" role="group" aria-label="Time window">
            {WINDOWS.map((w) => (
              <button key={w.id} aria-pressed={win.id === w.id} onClick={() => { setWin({ id: w.id }); setOpen(null); }}>{w.n} {w.u}</button>
            ))}
          </div>
          <form className="dates" onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setWin({ id: 'custom', from: f.get('from'), to: f.get('to') }); setOpen(null);
          }}>
            <label>From<input type="date" name="from" defaultValue={win.from || iso(Date.now() - 14 * DAY)} max={iso(Date.now())} required /></label>
            <label>To<input type="date" name="to" defaultValue={win.to || iso(Date.now())} max={iso(Date.now())} required /></label>
            <button className="btn" type="submit">Show these dates</button>
          </form>
        </div>
      )}

      {!d && !digest.error && <div className="skeleton-stack"><i /><i /></div>}
      {digest.error && !d && <div className="notice bad" role="alert">Filings did not load: {digest.error}. <button className="link" onClick={digest.reload}>Try again</button></div>}

      {d && (
        <article className="hero-card" aria-live="polite">
          <span className="hero-time">
            {top ? `${ago(top.ts)} · ${top.label}` : eod ? `Close of ${new Date(eod).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : 'Today'}
          </span>
          <div className="hero-row">
            <h2 className={top ? undefined : 'clear-title'}>{top ? short(top.headline) : 'All clear'}</h2>
            {top && (
              <span className="stack" aria-label={`${material.length} material filings`}>
                <button className="ava" onClick={() => go('research', top.ticker)} aria-label={`Research ${top.ticker}`}>{top.ticker[0]}</button>
                {others.slice(0, 1).map((t) => <span key={t} className="ava b">{t[0]}</span>)}
                {others.length > 1 && <span className="ava more">+{others.length - 1}</span>}
              </span>
            )}
          </div>
          <p className="hero-sub">{top ? top.company : `${num(d.filings)} filings across ${portfolio.length} holdings. None need you.`}</p>
          {top
            ? <button className="mini-btn" onClick={() => toggle('hero')} aria-expanded={open === 'hero'}>{open === 'hero' ? 'Close' : 'Read'}</button>
            : win.id !== '7d' && win.id !== '30d'
              ? <button className="mini-btn" onClick={() => setWin({ id: '7d' })}>Widen to 7 days</button>
              : <a className="mini-btn" href="#/rules">Adjust alerts</a>}
          {top && open === 'hero' && <Filing item={top} embedded onClear={clear} go={go} />}
        </article>
      )}

      {mkt.data && <Pulse quotes={mkt.data} go={go} open={open === 'pulse'} onToggle={() => toggle('pulse')} />}

      {d && (
        <>
          <span className="label">Also</span>
          <div className="duo">
            <button className="tile-card tint" onClick={() => toggle('moves')} aria-expanded={open === 'moves'}>
              <strong>Moves</strong>
              <small>{!mkt.data ? 'Loading prices' : moves.length ? `${moves.length} past ±${rules.price}%` : 'Quiet close'}</small>
              <span className="tile-orb" aria-hidden="true" />
              <span className="round-sm"><Icon d={moves.length ? ARROW : CHECK} /></span>
            </button>
            <button className="tile-card" onClick={() => toggle('glance')} aria-expanded={open === 'glance'} disabled={!glance.length}>
              <strong>Glance</strong>
              <small>{glance.length ? `${glance.length} worth a look` : 'Nothing else'}</small>
              <span className="pill-sm">{glance.length ? (open === 'glance' ? 'Hide' : 'Show') : '0'}</span>
            </button>
          </div>

          {open === 'moves' && (
            <div className="panel">
              {moves.length === 0 && <p className="quiet">No holding moved past ±{rules.price}% or {rules.volume}× volume. <a className="link" href="#/rules">Change</a></p>}
              {moves.map(({ q, m }) => (
                <button key={q.ticker} className="line" onClick={() => go('research', q.ticker)}>
                  <span><b>{q.ticker}</b><small className={dir(q.changePct)}>{m.text}</small></span>
                  <span className="line-side"><Spark values={q.spark} /><small>{price(q.close)}</small></span>
                </button>
              ))}
            </div>
          )}
          {open === 'glance' && (
            <div className="panel rows">{glance.map((it) => <Filing key={it.id} item={it} onClear={clear} go={go} />)}</div>
          )}

          {rest.length > 0 && (
            <div className="list-card">
              {rest.slice(0, open === 'more' ? undefined : 2).map((it) => (
                <details key={it.id} className="list-item">
                  <summary><strong>{short(it.headline)}</strong><small>{it.ticker} · {it.label} · {ago(it.ts)}</small></summary>
                  <Filing item={it} embedded onClear={clear} go={go} />
                </details>
              ))}
              {rest.length > 2 && open !== 'more' && <button className="list-more" onClick={() => setOpen('more')}>{rest.length - 2} more that matter</button>}
            </div>
          )}

          {routine.length > 0 && (
            <details className="routine">
              <summary>{routine.length} routine filing{routine.length > 1 ? 's' : ''} hidden<span>Show</span></summary>
              <div className="rows">
                {routine.map((it) => (
                  <a key={it.id} className="row mini-row" href={it.url} target="_blank" rel="noreferrer">
                    <span className="ticker">{it.ticker}</span><span className="row-text">{it.headline}</span>
                  </a>
                ))}
              </div>
            </details>
          )}

          <a className="strip" href="#/research">
            <span className="round-sm"><Icon d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16.5 16.5 20 20" /></span>
            <span>Research a company</span>
            <span className="round-sm"><Icon d={ARROW} /></span>
          </a>
          {cleared.length > 0 && (d.items || []).some((it) => cleared.includes(it.id)) && (
            <p className="fine center"><button className="link" onClick={() => setCleared([])}>Bring back cleared filings</button></p>
          )}
        </>
      )}
    </>
  );
}
