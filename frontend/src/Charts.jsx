import { useState } from 'react';
import { fy } from './lib.js';

const W = 320, H = 116, PAD = 4, TOP = 6, BOTTOM = 18;
export const S1 = 'var(--s1)', S2 = 'var(--s2)';

export function Spark({ values, w = 64, h = 22 }) {
  if (!values || values.length < 2) return null;
  const min = Math.min(...values), max = Math.max(...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 2 - ((v - min) / (max - min || 1)) * (h - 4)}`).join(' ');
  const way = values.at(-1) >= values[0] ? 'up' : 'down';
  return <svg className={`spark ${way}`} viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true"><polyline points={pts} /></svg>;
}

/**
 * One or two series on one axis. The row above the plot is both the legend and the
 * readout: it shows the latest period until a finger or pointer scrubs to another.
 */
export function Chart({ series, kind = 'bar', fmt = (v) => v, label }) {
  const periods = series[0].data.map((p) => p.period);
  const n = periods.length;
  const [active, setActive] = useState(null);
  if (n < 2) return null;
  const i = active ?? n - 1;
  const all = series.flatMap((s) => s.data.map((p) => p.v)).filter((v) => v != null);
  if (!all.length) return null;
  let max = Math.max(...all), min = Math.min(...all);
  if (kind === 'bar') { max = Math.max(max, 0); min = Math.min(min, 0); } else { const pad = (max - min || 1) * 0.15; max += pad; min -= pad; }
  const plotH = H - TOP - BOTTOM;
  const y = (v) => TOP + ((max - v) / (max - min || 1)) * plotH;
  const slot = (W - 2 * PAD) / n;
  const x = (k) => PAD + (k + 0.5) * slot;
  const bw = Math.min(18, (slot * 0.72) / series.length);

  const scrub = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const k = Math.floor((((e.clientX - r.left) / r.width) * W - PAD) / slot);
    setActive(Math.max(0, Math.min(n - 1, k)));
  };
  // Touch: a tap selects a period and the selection stays (a touch fires pointerleave right after
  // pointerup, which used to wipe it). Capturing the pointer keeps a horizontal drag scrubbing even
  // when the finger slides off the chart; touch-action: pan-y in CSS leaves vertical scrolling alone.
  const down = (e) => { if (e.pointerType !== 'mouse') e.currentTarget.setPointerCapture?.(e.pointerId); scrub(e); };
  const leave = (e) => { if (e.pointerType === 'mouse') setActive(null); };
  const key = (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      setActive((a) => Math.max(0, Math.min(n - 1, (a ?? n - 1) + (e.key === 'ArrowRight' ? 1 : -1))));
    } else if (e.key === 'Escape') setActive(null);
  };
  const bar = (v, cx) => {
    const y0 = y(0), y1 = y(v), top = Math.min(y0, y1), h = Math.max(Math.abs(y1 - y0), 1), r = Math.min(3, h, bw / 2);
    const x0 = cx - bw / 2;
    return v >= 0
      ? `M${x0} ${top + h}V${top + r}q0 ${-r} ${r} ${-r}h${bw - 2 * r}q${r} 0 ${r} ${r}V${top + h}z`
      : `M${x0} ${top}V${top + h - r}q0 ${r} ${r} ${r}h${bw - 2 * r}q${r} 0 ${r} ${-r}V${top}z`;
  };

  return (
    <figure className="chart">
      <figcaption>
        <span className="chart-period">{label ? `${label} · ` : ''}{fy(periods[i])}</span>
        <span className="chart-values">
          {series.map((s) => (
            <span key={s.name} className="chart-value">
              {series.length > 1 && <i style={{ background: s.color }} />}
              {series.length > 1 && <em>{s.name}</em>}
              <b>{s.data[i]?.v == null ? '–' : fmt(s.data[i].v)}</b>
            </span>
          ))}
        </span>
      </figcaption>
      <svg className="chart-plot" viewBox={`0 0 ${W} ${H}`} role="img" tabIndex={0}
        aria-label={`${label || series[0].name} by period, latest ${fmt(series[0].data.at(-1)?.v)}. Use the left and right arrow keys to read other periods.`}
        onPointerMove={scrub} onPointerDown={down} onPointerLeave={leave} onKeyDown={key}>
        <line className="axis" x1={PAD} x2={W - PAD} y1={kind === 'bar' ? y(0) : H - BOTTOM} y2={kind === 'bar' ? y(0) : H - BOTTOM} />
        {kind === 'bar' && series.map((s, si) => s.data.map((p, k) => p.v != null && (
          <path key={`${si}-${k}`} d={bar(p.v, x(k) + (si - (series.length - 1) / 2) * (bw + 2))} fill={s.color} opacity={k === i ? 1 : 0.5} />
        )))}
        {kind === 'line' && series.map((s) => {
          const pts = s.data.map((p, k) => (p.v == null ? null : `${x(k)},${y(p.v)}`)).filter(Boolean).join(' ');
          return (
            <g key={s.name}>
              <polyline points={pts} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {s.data[i]?.v != null && <circle cx={x(i)} cy={y(s.data[i].v)} r="4.5" fill={s.color} stroke="var(--surface)" strokeWidth="2" />}
            </g>
          );
        })}
        {kind === 'line' && <line className="cursor" x1={x(i)} x2={x(i)} y1={TOP} y2={H - BOTTOM} />}
        <text className="tick" x={PAD} y={H - 4}>{fy(periods[0])}</text>
        <text className="tick" x={W - PAD} y={H - 4} textAnchor="end">{fy(periods[n - 1])}</text>
      </svg>
    </figure>
  );
}
