import { useEffect, useState } from 'react';
import { DEFAULT_RULES, num, accessCode } from './lib.js';
import { Search } from './Research.jsx';

const STATES = [['auto', 'FINN decides'], ['always', 'Always alert'], ['mute', 'Mute']];

// Shown only while there is something to do: once FINN is installed the row disappears.
function Install() {
  const [can, setCan] = useState(!!window.finnInstall);
  const [done, setDone] = useState(window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true);
  useEffect(() => {
    const on = () => setCan(true);
    const installed = () => setDone(true);
    window.addEventListener('finn-installable', on);
    window.addEventListener('appinstalled', installed);
    return () => { window.removeEventListener('finn-installable', on); window.removeEventListener('appinstalled', installed); };
  }, []);
  if (done) return null;
  const install = async () => {
    const e = window.finnInstall;
    if (!e) return;
    e.prompt();
    const { outcome } = await e.userChoice;
    if (outcome === 'accepted') { window.finnInstall = null; setCan(false); setDone(true); }
  };
  return (
    <div className="install-row">
      <img src="/icons/icon-192.png" alt="" width="40" height="40" />
      <span>
        <b>Put FINN on your home screen</b>
        <small>{can ? 'Opens full screen, keeps the last brief offline.' : 'iPhone: Share, then Add to Home Screen.'}</small>
      </span>
      {can && <button className="mini-btn" onClick={install}>Install</button>}
    </div>
  );
}

export default function Rules({ meta, portfolio, setPortfolio, rules, setRules, reloadMeta }) {
  const [note, setNote] = useState('');
  const set = (patch) => setRules((r) => ({ ...r, ...patch }));
  const setCat = (cat, v) => setRules((r) => {
    const categories = { ...r.categories };
    if (v === 'auto') delete categories[cat]; else categories[cat] = v;
    return { ...r, categories };
  });

  const notify = async () => {
    if (rules.notify) { set({ notify: false }); return; }
    if (typeof Notification === 'undefined') { setNote('This browser does not offer notifications. On iPhone, add FINN to the home screen first.'); return; }
    const p = await Notification.requestPermission();
    if (p === 'granted') { set({ notify: true }); setNote(''); } else setNote('Notifications are blocked for this site in the browser settings.');
  };

  const llm = meta?.llm;
  const u = llm?.usage;

  const overridden = Object.keys(rules.categories || {}).length;

  return (
    <>
      <header className="home-head">
        <div>
          <h1>Rules</h1>
          <p>Changes apply at once</p>
        </div>
      </header>

      <Install />

      <section className="set">
        <h2>Alerts</h2>
        <div className="card">
          <label className="slider">
            <span>Price move beyond <b>±{rules.price}%</b></span>
            <input type="range" min="1" max="10" step="0.5" value={rules.price} onChange={(e) => set({ price: +e.target.value })} />
          </label>
          <label className="slider">
            <span>Volume above <b>{rules.volume}×</b> the 20-day average</span>
            <input type="range" min="1.2" max="5" step="0.1" value={rules.volume} onChange={(e) => set({ volume: +e.target.value })} />
          </label>
          <button className="switch-row" role="switch" aria-checked={!!rules.notify} onClick={notify}>
            <span>Notify this phone<small>When a filing that matters arrives</small></span>
            <i className="switch" aria-hidden="true" />
          </button>
          {note && <p className="fine">{note}</p>}
          {(rules.price !== DEFAULT_RULES.price || rules.volume !== DEFAULT_RULES.volume) && (
            <button className="link small" onClick={() => set({ price: DEFAULT_RULES.price, volume: DEFAULT_RULES.volume })}>Reset to ±{DEFAULT_RULES.price}% and {DEFAULT_RULES.volume}×</button>
          )}
        </div>
      </section>

      <section className="set">
        <h2>Portfolio <span className="h-note">{portfolio.length} holdings</span></h2>
        <div className="card">
          <Search placeholder="Add a company" onPick={(t) => setPortfolio([...new Set([...portfolio, t])])} />
          <div className="chips holdings">
            {portfolio.map((t) => (
              <button key={t} className="chip-btn sm" onClick={() => setPortfolio(portfolio.filter((x) => x !== t))} aria-label={`Remove ${t}`}>{t}<span aria-hidden="true"> ×</span></button>
            ))}
          </div>
          {meta && <button className="link small" onClick={() => setPortfolio(null)}>Restore the default portfolio</button>}
        </div>
      </section>

      <section className="set">
        <h2>More</h2>
        <div className="rows">
          <details className="row fold">
            <summary><span className="row-text">Filing types</span><span className="fold-v">{overridden ? `${overridden} overridden` : 'FINN decides'}</span></summary>
            <div className="fold-body">
              {Object.entries(meta?.categories || {}).map(([cat, label]) => (
                <div key={cat} className="row pick">
                  <span className="row-text">{label}</span>
                  <select aria-label={`${label} filings`} value={rules.categories?.[cat] || 'auto'} onChange={(e) => setCat(cat, e.target.value)}>
                    {STATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </details>
          <details className="row fold">
            <summary><span className="row-text">Under the hood</span><span className="fold-v">{llm?.enabled ? llm.provider?.toUpperCase() : 'Rules only'}</span></summary>
            <div className="fold-body facts">
              <div><span>Prices</span><b>Yahoo Finance, end of day</b></div>
              <div><span>Filings</span><b>NSE feed, {num(meta?.feed?.lastCount)} live, plus BSE</b></div>
              <div><span>Fundamentals</span><b>Screener, annual reports, transcripts</b></div>
              <div><span>Storage</span><b>{meta?.store === 'mongo' ? 'MongoDB' : 'JSON files'}</b></div>
              <div><span>Model</span><b>{llm?.enabled ? llm.fast : llm?.problem || 'None set'}</b></div>
              {u && <div><span>Tokens this session</span><b>{num(u.fast.in + u.fast.out)} fast, {num(u.smart.in + u.smart.out)} smart</b></div>}
              {u && <div><span>Answers from cache</span><b>{num(u.cacheHits)}</b></div>}
              <div><span /><button className="link small" onClick={reloadMeta}>Refresh</button></div>
            </div>
          </details>
        </div>
        {meta?.access && (
          <button className="link small" onClick={() => { accessCode.set(''); window.location.reload(); }}>Lock FINN on this device</button>
        )}
      </section>
    </>
  );
}
