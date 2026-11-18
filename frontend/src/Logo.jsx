// Company marks for list rows. Six companies have a clear public icon (served from /logos);
// every other ticker gets a lettered badge, tinted by a hash of the ticker so a company keeps
// the same colour everywhere. Only tickers in REAL are requested, so no request ever 404s.
const REAL = new Set(['INFY', 'SUNPHARMA', 'DIXON', 'ETERNAL', 'DEEPAKNTR', 'POLYCAB']);
const TINTS = 6;

const tint = (t) => [...t].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % TINTS;
const letters = (t) => (/^\d+$/.test(t) ? t.slice(-2) : t.replace(/[^A-Z0-9]/gi, '').slice(0, 2)).toUpperCase();

export default function Logo({ ticker, size = 36, round = false }) {
  const t = String(ticker || '').toUpperCase();
  const style = { width: size, height: size };
  const shape = round ? ' round' : '';
  if (REAL.has(t)) {
    return (
      <span className={`logo img${shape}`} style={style} aria-hidden="true">
        <img src={`/logos/${t}.png`} alt="" width={size} height={size} loading="lazy" decoding="async" />
      </span>
    );
  }
  return <span className={`logo mono t${tint(t)}${shape}`} style={style} aria-hidden="true">{letters(t)}</span>;
}
