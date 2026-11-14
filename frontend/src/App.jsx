import { useEffect, useState } from 'react';
import { api, useAsync, useLocal, DEFAULT_RULES } from './lib.js';
import Brief from './Brief.jsx';
import Research from './Research.jsx';
import Rules from './Rules.jsx';

const parseHash = () => {
  const [, tab = 'brief', arg] = window.location.hash.split('/');
  return { tab: ['brief', 'research', 'rules'].includes(tab) ? tab : 'brief', arg: arg ? decodeURIComponent(arg) : null };
};

const TABS = [
  { id: 'brief', label: 'Brief', d: 'M7 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 9h6M9 13h6M9 17h3' },
  { id: 'research', label: 'Research', d: 'M5 20V11M10 20V5M15 20v-7M20 20V9M3 20h18' },
  { id: 'rules', label: 'Rules', d: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 4.5v5M9 14.5v5' },
];

export default function App() {
  const [route, setRoute] = useState(parseHash);
  const meta = useAsync(api.meta, []);
  const [portfolio, setPortfolio] = useLocal('finn.portfolio', null);
  const [rules, setRules] = useLocal('finn.rules', DEFAULT_RULES);

  useEffect(() => {
    const on = () => { setRoute(parseHash()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

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
        {holdings && route.tab === 'brief' && <Brief portfolio={holdings} rules={rules} go={go} />}
        {holdings && route.tab === 'research' && <Research ticker={route.arg} meta={meta.data} portfolio={holdings} go={go} />}
        {holdings && route.tab === 'rules' && (
          <Rules meta={meta.data} portfolio={holdings} setPortfolio={setPortfolio} rules={rules} setRules={setRules} reloadMeta={meta.reload} />
        )}
        {!holdings && !meta.error && <div className="skeleton-stack"><i /><i /><i /></div>}
      </main>
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
