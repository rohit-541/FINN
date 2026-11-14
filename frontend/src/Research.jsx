import { useEffect, useRef, useState } from 'react';
import { api, useAsync, cr, num, pct, dir, price, fy } from './lib.js';
import { Chart, S1, S2 } from './Charts.jsx';

const QUESTIONS = ['What did management guide for margins?', 'What is the capex plan?', 'What did analysts press on in the last call?'];
const VERDICT = { delivered: 'Delivered', partly: 'Partly', missed: 'Missed', too_early: 'Too early' };
const lastOf = (s, back = 0) => s?.filter((p) => p.v != null).at(-1 - back);
const tail = (s, n = 10) => (s || []).filter((p) => p.v != null).slice(-n);

export function Search({ onPick, placeholder = 'Search any NSE company', autoFocus }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) { setRows([]); return undefined; }
    setBusy(true);
    const t = setTimeout(() => api.search(q.trim()).then(setRows).catch(() => setRows([])).finally(() => setBusy(false)), 220);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="search">
      <label className="sr" htmlFor="company-search">{placeholder}</label>
      <input id="company-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder}
        autoComplete="off" autoCapitalize="characters" spellCheck="false" autoFocus={autoFocus} />
      {q.trim().length >= 2 && (
        <div className="search-results">
          {rows.map((r) => (
            <button key={r.ticker} onClick={() => { onPick(r.ticker); setQ(''); }}>
              <span>{r.name}</span><span className="ticker">{r.ticker}</span>
            </button>
          ))}
          {!busy && rows.length === 0 && <p className="fine">No company matches "{q}".</p>}
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, sub }) {
  return <div className="tile"><span className="tile-label">{label}<i aria-hidden="true">↗</i></span><span className="tile-value">{value}</span>{sub && <span className="tile-sub">{sub}</span>}</div>;
}

function Analysis({ ticker, enabled, onData }) {
  const [job, setJob] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true, timer;
    const poll = () => api.analysis(ticker).then((j) => {
      if (!live) return;
      setJob(j);
      if (j.status === 'done') onData(j.data);
      if (j.status === 'running') timer = setTimeout(poll, 2500);
    }).catch((e) => live && setJob({ status: 'error', error: e.message }));
    poll();
    return () => { live = false; clearTimeout(timer); };
  }, [ticker, enabled, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!enabled) {
    return (
      <div className="notice">
        <strong>The transcripts are found but not yet read.</strong> Set one model key in <code>backend/.env</code> and FINN reads the last
        four calls, lists what management promised, and marks each promise against the quarters that followed. Everything else on
        this page is computed without a model.
      </div>
    );
  }
  if (!job || job.status === 'running') {
    return <div className="working" role="status"><span className="pulse" />{job?.stage || 'Finding the documents'}<span className="fine">First read takes about a minute. After that it is instant.</span></div>;
  }
  if (job.status === 'error') {
    return <div className="notice bad">The read failed: {job.error} <button className="link" onClick={() => setTick((t) => t + 1)}>Try again</button></div>;
  }
  const v = job.data.verdict;
  if (!v) return <p className="quiet">No call transcript could be read for this company, so there is nothing to check promises against.</p>;
  return (
    <>
      {v.credibility && (
        <div className={`cred ${v.credibility.rating}`}>
          <span className="cred-label">Delivery record: {v.credibility.rating}</span>
          <p>{v.credibility.line}</p>
        </div>
      )}
      <div className="promises">
        {(v.promises || []).map((p, i) => (
          <article key={i} className="promise">
            <div className="promise-top"><span className={`verdict ${p.verdict}`}>{VERDICT[p.verdict] || p.verdict}</span><span className="fine">{p.said_in}</span></div>
            <h4>{p.promise}{p.target && <span className="target"> {p.target}</span>}</h4>
            <p className="delivered">{p.delivered}</p>
            {p.quote && <blockquote>{p.quote}</blockquote>}
          </article>
        ))}
      </div>
      {(v.agree?.length > 0 || v.diverge?.length > 0) && (
        <div className="split">
          <div><h4>Story matches numbers</h4><ul>{(v.agree || []).map((x) => <li key={x}>{x}</li>)}</ul></div>
          <div><h4>Story and numbers part</h4><ul>{(v.diverge || []).map((x) => <li key={x}>{x}</li>)}</ul></div>
        </div>
      )}
      {job.data.warnings?.length > 0 && <p className="fine">Not read: {job.data.warnings.join('; ')}</p>}
    </>
  );
}

function Ask({ ticker, enabled }) {
  const [q, setQ] = useState('');
  const [state, setState] = useState(null);
  const send = (question) => {
    setQ(question);
    setState({ loading: true });
    api.ask(ticker, question).then((a) => setState({ a })).catch((e) => setState({ error: e.message }));
  };
  return (
    <>
      <form className="ask" onSubmit={(e) => { e.preventDefault(); if (q.trim().length > 2) send(q.trim()); }}>
        <label className="sr" htmlFor="ask">Question for the filings</label>
        <input id="ask" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask the transcripts a question" disabled={!enabled} />
        <button className="btn" type="submit" disabled={!enabled || state?.loading}>{state?.loading ? 'Reading…' : 'Ask'}</button>
      </form>
      {enabled ? (
        <div className="chips">{QUESTIONS.map((x) => <button key={x} className="chip-btn" onClick={() => send(x)}>{x}</button>)}</div>
      ) : <p className="fine">Asking needs a model key on the backend.</p>}
      {state?.error && <p className="fine">That did not work: {state.error}</p>}
      {state?.a && (
        <div className="answer">
          <p>{state.a.answer}</p>
          {(state.a.sources || []).map((s, i) => (
            <blockquote key={i}>{s.quote}<cite>{s.doc}{s.page ? `, p.${s.page}` : ''}</cite></blockquote>
          ))}
        </div>
      )}
    </>
  );
}

function Company({ ticker, go }) {
  const facts = useAsync(() => api.facts(ticker), [ticker]);
  const [deep, setDeep] = useState(null);
  const refs = useRef({});
  useEffect(() => setDeep(null), [ticker]);
  const f = facts.data;

  if (facts.error && !f) {
    return <div className="notice bad" role="alert">No data for {ticker}: {facts.error}. <a className="link" href="#/research">Search again</a></div>;
  }
  if (!f) return <div className="skeleton-stack"><i /><i /><i /><i /></div>;

  const r = f.ratios;
  const px = f.price;
  const sections = [['promise', 'Promise vs delivered'], ['quarters', 'Quarters'], ['trajectory', 'Trajectory'], ...(f.financial ? [] : [['balance', 'Balance sheet'], ['cash', 'Cash']]), ['case', 'Bull vs bear'], ['sources', 'Sources']];
  const jump = (id) => refs.current[id]?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  const sec = (id) => ({ ref: (el) => { refs.current[id] = el; }, className: 'anchor' });
  const de = lastOf(f.balance.de), ccc = lastOf(f.balance.ccc);
  const cashPeriods = tail(f.cash.cfo, 8).map((p) => p.period);
  const align = (s) => cashPeriods.map((period) => ({ period, v: s.find((p) => p.period === period)?.v ?? null }));
  const b = deep?.business;
  const v = deep?.verdict;

  return (
    <>
      <header className="co-head">
        <a className="back" href="#/research">Research</a>
        <h1>{f.name}</h1>
        <div className="co-line">
          <span className="ticker">{f.ticker}</span>
          {px && <><span className="mono">{price(px.close)}</span><span className={`delta ${dir(px.changePct)}`}>{pct(px.changePct)}</span></>}
          <span className="soft">{cr(r['Market Cap'])}</span>
        </div>
        <p className="about">{b?.what_it_does || f.about}</p>
      </header>

      <div className="tiles">
        <Tile label="Revenue, last 12 months" value={cr(f.ttm.revenue)} sub={f.growth.revenue3 != null && `${pct(f.growth.revenue3)} a year over 3 years`} />
        <Tile label="Profit after tax" value={cr(f.ttm.pat)} sub={f.growth.pat3 != null && `${pct(f.growth.pat3)} a year over 3 years`} />
        {f.financial
          ? <Tile label="Return on equity" value={r.ROE != null ? `${r.ROE}%` : '–'} sub={r['Book Value'] != null && `Book value ₹${num(r['Book Value'])}`} />
          : <Tile label="Operating margin" value={f.ttm.opm != null ? `${f.ttm.opm}%` : '–'} sub={r.ROCE != null && `ROCE ${r.ROCE}%`} />}
        <Tile label="Price to earnings" value={r['Stock P/E'] != null ? `${r['Stock P/E']}×` : '–'} sub={px && `52-week ${price(px.low52)} to ${price(px.high52)}`} />
      </div>

      <section>
        <h2>What the numbers say</h2>
        <ul className="signals">
          {f.signals.map((s) => <li key={s.text} className={s.tone}><span className="sr">{s.tone}: </span>{s.text}</li>)}
        </ul>
      </section>

      <nav className="jump" aria-label="On this page">
        {sections.map(([id, label]) => <button key={id} onClick={() => jump(id)}>{label}</button>)}
      </nav>

      <section {...sec('promise')}>
        <h2>Promise vs delivered <span className="h-note">last {Math.min(4, f.docs.concalls.filter((c) => c.transcript).length)} calls against reported quarters</span></h2>
        <Analysis ticker={f.ticker} enabled={f.llm} onData={setDeep} />
        {v?.guidance_now?.length > 0 && (
          <>
            <h3 className="sub">Guidance that still stands</h3>
            <ul className="guide">
              {v.guidance_now.map((g, i) => (
                <li key={i}>
                  <span className="guide-metric">{g.metric}</span>
                  <strong>{g.target}</strong>
                  <small>{[g.horizon && g.horizon !== 'unspecified' && `By ${g.horizon}`, g.said_in && `said in the ${g.said_in}`].filter(Boolean).join(' · ')}</small>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section {...sec('quarters')}>
        <h2>Quarters <span className="h-note">₹ Cr, {f.view}</span></h2>
        <div className="scroll-x">
          <table className="grid num">
            <thead><tr><th scope="col">Quarter</th><th scope="col">Revenue</th><th scope="col">YoY</th><th scope="col">Margin</th><th scope="col">PAT</th><th scope="col">YoY</th></tr></thead>
            <tbody>
              {[...f.quarters].reverse().map((q) => (
                <tr key={q.period}>
                  <th scope="row">{q.period.replace(/ 20/, " ")}</th><td>{num(q.revenue)}</td><td className={`delta ${dir(q.revenueYoy)}`}>{pct(q.revenueYoy, 0)}</td>
                  <td>{q.opm != null ? `${q.opm}%` : '–'}</td><td>{num(q.pat)}</td><td className={`delta ${dir(q.patYoy)}`}>{pct(q.patYoy, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section {...sec('trajectory')}>
        <h2>Trajectory</h2>
        <div className="pair">
          <Chart label="Revenue" series={[{ name: 'Revenue', color: S1, data: tail(f.annual.revenue) }]} fmt={cr} />
          <Chart label="Profit after tax" series={[{ name: 'PAT', color: S1, data: tail(f.annual.pat) }]} fmt={cr} />
        </div>
        {!f.financial && <Chart label="Operating margin" kind="line" series={[{ name: 'Margin', color: S1, data: tail(f.annual.opm) }]} fmt={(x) => `${x}%`} />}
        <div className="facts">
          {[['Revenue, 3 years', f.growth.revenue3], ['Revenue, 5 years', f.growth.revenue5], ['Revenue, 10 years', f.growth.revenue10], ['Profit, 3 years', f.growth.pat3], ['Profit, 5 years', f.growth.pat5]]
            .filter(([, x]) => x != null).map(([k, x]) => <div key={k}><span>{k}</span><b className={`delta ${dir(x)}`}>{pct(x)} a year</b></div>)}
        </div>
      </section>

      {!f.financial && (
        <>
          <section {...sec('balance')}>
            <h2>Balance sheet</h2>
            <div className="pair">
              <Chart label="Borrowings" series={[{ name: 'Borrowings', color: S1, data: tail(f.balance.borrowings) }]} fmt={cr} />
              <Chart label="Debt to equity" kind="line" series={[{ name: 'D/E', color: S1, data: tail(f.balance.de) }]} fmt={(x) => `${x}×`} />
            </div>
            <Chart label="Cash conversion cycle" kind="line" series={[{ name: 'Days', color: S1, data: tail(f.balance.ccc) }]} fmt={(x) => `${x} days`} />
            <div className="facts">
              {[['Debt to equity', de && `${de.v}×`], ['Debtor days', lastOf(f.balance.debtorDays)?.v], ['Inventory days', lastOf(f.balance.inventoryDays)?.v], ['Payable days', lastOf(f.balance.payableDays)?.v], ['Cash conversion cycle', ccc && `${ccc.v} days`], ['ROCE', lastOf(f.balance.roce) && `${lastOf(f.balance.roce).v}%`]]
                .filter(([, x]) => x != null && x !== false).map(([k, x]) => <div key={k}><span>{k}</span><b>{x}</b></div>)}
            </div>
          </section>

          <section {...sec('cash')}>
            <h2>Cash quality <span className="h-note">do profits turn into cash?</span></h2>
            <Chart label="Cash against profit" series={[{ name: 'Operating cash', color: S1, data: align(f.cash.cfo) }, { name: 'PAT', color: S2, data: align(f.cash.pat) }]} fmt={cr} />
            <Chart label="Free cash flow" series={[{ name: 'FCF', color: S1, data: tail(f.cash.fcf, 8) }]} fmt={cr} />
            {f.cash.conversion5 != null && (
              <div className="facts"><div><span>Operating cash per ₹100 of profit, 5 years</span><b>₹{Math.round(f.cash.conversion5)}</b></div></div>
            )}
          </section>
        </>
      )}

      <section {...sec('case')}>
        <h2>Bull vs bear</h2>
        {v?.bull ? (
          <div className="split">
            <div className="bull"><h4>For</h4><ul>{v.bull.map((x) => <li key={x}>{x}</li>)}</ul></div>
            <div className="bear"><h4>Against</h4><ul>{(v.bear || []).map((x) => <li key={x}>{x}</li>)}</ul></div>
          </div>
        ) : <p className="quiet">{f.llm ? 'Written once the calls above are read.' : 'Written from the transcripts once a model key is set. The verdicts at the top are the model-free version.'}</p>}
        {b?.segments?.length > 0 && (
          <>
            <h3 className="sub">Segments, from the annual report</h3>
            <div className="facts">{b.segments.map((s) => <div key={s.name}><span>{s.name}{s.note && <em> {s.note}</em>}</span><b>{s.share_pct != null ? `${s.share_pct}%` : ''}</b></div>)}</div>
          </>
        )}
      </section>

      <section>
        <h2>Ask the filings</h2>
        <Ask ticker={f.ticker} enabled={f.llm} />
      </section>

      <section {...sec('sources')}>
        <h2>Sources <span className="h-note">company filings only</span></h2>
        <div className="rows">
          {f.docs.concalls.filter((c) => c.transcript).map((c) => <a key={c.transcript} className="row src" href={c.transcript} target="_blank" rel="noreferrer"><span className="row-text">Earnings call transcript</span><span className="mono">{c.period}</span></a>)}
          {f.docs.annualReports.map((a) => <a key={a.url} className="row src" href={a.url} target="_blank" rel="noreferrer"><span className="row-text">{a.title}</span><span className="mono">PDF</span></a>)}
          <a className="row src" href={`https://www.screener.in/company/${f.ticker}/`} target="_blank" rel="noreferrer"><span className="row-text">Reported financials, standardised</span><span className="mono">Screener</span></a>
        </div>
        <button className="btn ghost wide" onClick={() => go('research')}>Research another company</button>
      </section>
    </>
  );
}

export default function Research({ ticker, meta, portfolio, go }) {
  if (ticker) return <Company key={ticker} ticker={ticker.toUpperCase()} go={go} />;
  return (
    <>
      <header className="top"><span className="title">Research</span><span className="pill">Filings only</span></header>
      <section className="lede">
        <h1>Research any NSE company.</h1>
        <p>FINN reads the company's own filings, then checks what management said against what the numbers did.</p>
        <Search onPick={(t) => go('research', t)} />
      </section>
      <section>
        <h2>Outside your portfolio</h2>
        <div className="chips">{(meta?.picks || []).map((t) => <a key={t} className="chip-btn" href={`#/research/${t}`}>{t}</a>)}</div>
      </section>
      <section>
        <h2>Your holdings</h2>
        <div className="chips">{portfolio.map((t) => <a key={t} className="chip-btn" href={`#/research/${t}`}>{t}</a>)}</div>
      </section>
    </>
  );
}
