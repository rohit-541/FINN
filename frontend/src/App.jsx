import { lazy, Suspense, useEffect, useState } from 'react';
import { api, useAsync, useLocal, DEFAULT_RULES, accessCode } from './lib.js';
import Brief from './Brief.jsx';

// The Brief is the first screen, so it ships in the main bundle. Research and Rules load on first
// visit, which keeps their code off the critical path. Rules reuses Research's Search, so the two
// share one chunk.
const Research = lazy(() => import('./Research.jsx'));
const Rules = lazy(() => import('./Rules.jsx'));

const parseHash = () => {
  const [, tab, arg] = window.location.hash.split('/');
  if (!tab) return { tab: 'brief', arg: null };
  return { tab: ['brief', 'research', 'rules'].includes(tab) ? tab : 'missing', arg: arg ? decodeURIComponent(arg) : null };
};

// The home screen keeps the full title from index.html (it is the indexed page); others say where you are.
const HOME_TITLE = document.title;
const titleOf = ({ tab, arg }) => ({
  brief: HOME_TITLE,
  research: arg ? `${arg.toUpperCase()} research · FINN` : 'Research · FINN',
  rules: 'Rules · FINN',
  missing: 'Page not found · FINN',
}[tab]);

function NotFound() {
  return (
    <section className="not-found">
      <span className="code" aria-hidden="true">404</span>
      <h1 className="title">Page not found</h1>
      <p>This screen does not exist. The brief and research are a tap away.</p>
      <a className="btn" href="#/brief">Back to the brief</a>
    </section>
  );
}

function Toasts() {
  const [t, setT] = useState(null);
  useEffect(() => {
    let timer;
    const on = (e) => { setT({ ...e.detail, id: Date.now() }); clearTimeout(timer); timer = setTimeout(() => setT(null), 2800); };
    window.addEventListener('finn-toast', on);
    return () => { window.removeEventListener('finn-toast', on); clearTimeout(timer); };
  }, []);
  return (
    <div role="status" aria-live="polite" className="sr-live">
      {t && <div key={t.id} className={`toast ${t.kind === 'bad' ? 'bad' : ''}`}>{t.text}</div>}
    </div>
  );
}

const Loading = () => <div className="skeleton-stack"><i /><i /><i /></div>;

const TABS = [
  { id: 'brief', label: 'Brief', d: 'M7 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 9h6M9 13h6M9 17h3' },
  { id: 'research', label: 'Research', d: 'M5 20V11M10 20V5M15 20v-7M20 20V9M3 20h18' },
  { id: 'rules', label: 'Rules', d: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 4.5v5M9 14.5v5' },
];

function Lock({ onOpen }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api.unlock(code.trim());
      accessCode.set(code.trim());
      onOpen();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <main className="lock">
      <form className="lock-card" onSubmit={submit}>
        <img src="/icons/icon-192.png" alt="" width="64" height="64" />
        <h1>FINN</h1>
        <p>This deployment is private. Enter the access code to continue.</p>
        <label className="sr" htmlFor="code">Access code</label>
        <input id="code" type="password" autoComplete="current-password" placeholder="Access code" value={code}
          onChange={(e) => setCode(e.target.value)} autoFocus required aria-invalid={!!error} aria-describedby={error ? 'code-err' : undefined} />
        {error && <p id="code-err" className="lock-err" role="alert">{error}</p>}
        <button className="btn" type="submit" disabled={busy || !code.trim()}>{busy ? 'Checking…' : 'Unlock FINN'}</button>
      </form>
    </main>
  );
}

// Asks the server whether a code is needed before anything else loads, and drops back to the
// lock screen whenever an API call is refused.
export default function App() {
  const [gate, setGate] = useState('checking'); // checking | locked | open
  useEffect(() => {
    api.access().then((a) => setGate(a.required && !a.ok ? 'locked' : 'open')).catch(() => setGate('open'));
    const lock = () => { accessCode.set(''); setGate('locked'); };
    window.addEventListener('finn-locked', lock);
    return () => window.removeEventListener('finn-locked', lock);
  }, []);
  useEffect(() => { if (gate === 'locked') window.finnReady?.(); }, [gate]);
  if (gate === 'checking') return <div className="shell"><main className="screen"><div className="skeleton-stack"><i /><i /><i /></div></main></div>;
  if (gate === 'locked') return <Lock onOpen={() => setGate('open')} />;
  return <Finn />;
}

function Finn() {
  const [route, setRoute] = useState(parseHash);
  const meta = useAsync(api.meta, []);
  const [portfolio, setPortfolio] = useLocal('finn.portfolio', null);
  const [rules, setRules] = useLocal('finn.rules', DEFAULT_RULES);

  useEffect(() => {
    const on = () => { setRoute(parseHash()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  useEffect(() => { document.title = titleOf(route); }, [route]);
  // The Brief lifts the splash itself once its data is in; any other first screen lifts it at once.
  useEffect(() => { if (route.tab !== 'brief' || meta.error) window.finnReady?.(); }, [route.tab, meta.error]);

  const go = (tab, arg) => { window.location.hash = `#/${tab}${arg ? `/${encodeURIComponent(arg)}` : ''}`; };
  const holdings = portfolio || meta.data?.portfolio;

  return (
    <div className="shell">
      <main className="screen">
        {meta.error && !meta.data && (
          <div className="notice bad" role="alert">
            <strong>FINN cannot reach its backend.</strong> Start it with <code>npm start</code> in <code>backend/</code>, then reload.
          </div>
        )}
        {route.tab === 'missing' && <NotFound />}
        <Suspense fallback={<Loading />}>
          {holdings && route.tab === 'brief' && <Brief portfolio={holdings} rules={rules} go={go} />}
          {holdings && route.tab === 'research' && <Research ticker={route.arg} meta={meta.data} portfolio={holdings} go={go} />}
          {holdings && route.tab === 'rules' && (
            <Rules meta={meta.data} portfolio={holdings} setPortfolio={setPortfolio} rules={rules} setRules={setRules} reloadMeta={meta.reload} />
          )}
        </Suspense>
        {!holdings && !meta.error && route.tab !== 'missing' && <Loading />}
      </main>
      <Toasts />
      <nav className="dock" aria-label="Sections">
        {TABS.map((t) => {
          const current = route.tab === t.id;
          return (
            <a key={t.id} href={t.id === 'research' && route.arg ? `#/research/${route.arg}` : `#/${t.id}`} className="dock-btn"
              aria-label={t.label} aria-current={current ? 'page' : undefined}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d={t.d} /></svg>
            </a>
          );
        })}
      </nav>
    </div>
  );
}
