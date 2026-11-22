'use client';

import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { fmtDate, fmtInt, fmtPct } from '@/lib/format';

/** One day: [YYYY-MM-DD, real holders, all holders]. null = no count that day (drawn as a gap). */
export type DayRow = [string, number | null, number | null];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDay = (d: string) => `${+d.slice(8, 10)} ${MONTHS[+d.slice(5, 7) - 1]}`;

function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const step = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * step >= v) return m * step;
  return 10 * step;
}
const tick = (v: number) => (v >= 10_000 ? `${+(v / 1000).toFixed(1)}k` : fmtInt(v));

/** Line and area paths in a 0–100 box, broken at every missing day; the partial last day is split off. */
function paths(vals: (number | null)[], max: number, partial: boolean) {
  const n = vals.length;
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * 100 : 50);
  const y = (v: number) => 100 - (v / max) * 100;
  const solidEnd = partial ? n - 2 : n - 1;
  let line = '';
  let area = '';
  let run: number[] = [];
  const flush = () => {
    if (run.length) {
      line += run.map((i, k) => `${k ? 'L' : 'M'}${x(i).toFixed(3)} ${y(vals[i]!).toFixed(3)}`).join('');
      if (run.length > 1) area += `M${x(run[0]).toFixed(3)} 100` + run.map((i) => `L${x(i).toFixed(3)} ${y(vals[i]!).toFixed(3)}`).join('') + `L${x(run[run.length - 1]).toFixed(3)} 100Z`;
    }
    run = [];
  };
  for (let i = 0; i <= solidEnd; i++) {
    if (vals[i] == null) flush();
    else run.push(i);
  }
  flush();
  let tail = '';
  if (partial && n >= 2 && vals[n - 1] != null && vals[n - 2] != null) {
    tail = `M${x(n - 2).toFixed(3)} ${y(vals[n - 2]!).toFixed(3)}L100 ${y(vals[n - 1]!).toFixed(3)}`;
    area += `M${x(n - 2).toFixed(3)} 100L${x(n - 2).toFixed(3)} ${y(vals[n - 2]!).toFixed(3)}L100 ${y(vals[n - 1]!).toFixed(3)}L100 100Z`;
  }
  return { line, area, tail };
}

interface XLabel {
  i: number;
  text: string;
  /** shown only where the plot is wide enough not to crowd its neighbours */
  wide?: boolean;
  today?: boolean;
}

/** Which days get a label under the chart: month starts on long ranges, every few days on short ones. */
function xLabels(days: string[], partial: boolean): XLabel[] {
  const n = days.length;
  const out: XLabel[] = [];
  const last = n - 1;
  const at = (i: number) => (n > 1 ? i / last : 0.5);
  if (n >= 45) {
    days.forEach((d, i) => d.endsWith('-01') && i > 0 && at(i) < 0.84 && out.push({ i, text: shortDay(d), wide: at(i) > 0.72 }));
    if (!out.length || at(out[0].i) > 0.1) out.unshift({ i: 0, text: shortDay(days[0]), wide: !!out.length && at(out[0].i) < 0.3 });
  } else {
    const every = Math.max(1, Math.ceil(n / 5));
    for (let i = 0; i < last; i += every) if (i === 0 || at(i) < 0.84) out.push({ i, text: shortDay(days[i]), wide: i > 0 && at(i) > 0.72 });
  }
  out.push({ i: last, text: partial ? 'Today' : shortDay(days[last]), today: partial });
  return out;
}

function Panel({ title, vals, idx, partial, height, strong }: { title: string; vals: (number | null)[]; idx: number; partial: boolean; height: number; strong?: boolean }) {
  const max = niceMax(Math.max(0, ...vals.map((v) => v ?? 0)));
  const { line, area, tail } = paths(vals, max, partial);
  const n = vals.length;
  const v = vals[idx];
  const left = n > 1 ? (idx / (n - 1)) * 100 : 50;
  return (
    <div className={`hh-panel${strong ? ' hh-strong' : ''}`}>
      <p className="hh-title" aria-hidden="true">{title}</p>
      <div className="hh-area" style={{ height }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <path className="hh-grid" d="M0 0H100M0 50H100" />
          <path className="hh-base" d="M0 100H100" />
          {area && <path className="hh-fill" d={area} />}
          {line && <path className="hh-line" d={line} />}
          {tail && <path className="hh-line hh-tail" d={tail} />}
        </svg>
        {[max, max / 2, 0].map((t, k) => (
          <span key={k} className="hh-y num" style={{ top: `${k * 50}%` }} aria-hidden="true">{tick(t)}</span>
        ))}
        <span className="hh-cross" style={{ left: `${left}%` }} aria-hidden="true" />
        {v != null && <span className={`hh-dot${partial && idx === n - 1 ? ' hh-dot-open' : ''}`} style={{ left: `${left}%`, top: `${100 - (v / max) * 100}%` }} aria-hidden="true" />}
      </div>
    </div>
  );
}

export default function HistoryChart({ rows, partial, label }: { rows: DayRow[]; partial: boolean; label: string }) {
  const n = rows.length;
  const [sel, setSel] = useState<number | null>(null);
  const [spoken, setSpoken] = useState('');
  const plot = useRef<HTMLDivElement>(null);
  const idx = sel ?? n - 1;
  const [day, real, holders] = rows[idx];
  const isToday = partial && idx === n - 1;
  const pct = real != null && holders ? (real / holders) * 100 : null;
  const dayText = `${fmtDate(day)}${isToday ? ', today so far' : ''}`;
  const sentence = (i: number) => {
    const [d, r, h] = rows[i];
    const when = `${fmtDate(d)}${partial && i === n - 1 ? ', today so far' : ''}`;
    if (r == null || h == null) return `${when}: no count for this day.`;
    return `${when}: ${fmtInt(r)} real holders of ${fmtInt(h)} holders, ${fmtPct(h ? (r / h) * 100 : 0)} real.`;
  };

  const fromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const area = plot.current?.querySelector('.hh-area');
    if (!area || n < 2) return;
    const r = area.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width)));
    setSel(Math.round(t * (n - 1)));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowDown: -1, ArrowUp: 1, PageDown: -7, PageUp: 7 };
    let next: number | null = null;
    if (e.key in steps) next = Math.min(n - 1, Math.max(0, idx + steps[e.key]));
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    if (next == null) return;
    e.preventDefault();
    setSel(next);
    setSpoken(sentence(next));
  };

  return (
    <figure className="hh">
      <div className="hh-read">
        <span className="hh-day">{dayText}</span>
        {real == null || holders == null ? (
          <span className="muted">No count for this day</span>
        ) : (
          <>
            <span><b className="num">{fmtInt(real)}</b> real holders</span>
            <span><b className="num">{fmtInt(holders)}</b> holders</span>
            <span><b className="num">{fmtPct(pct)}</b> real</span>
          </>
        )}
      </div>
      <div
        ref={plot}
        className="hh-plot"
        tabIndex={0}
        role="group"
        aria-roledescription="chart"
        aria-label={`${label} Use the left and right arrow keys to move between days, Home and End for the first and last day.`}
        onPointerMove={fromPointer}
        onPointerDown={fromPointer}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setSel(null)}
        onKeyDown={onKey}
      >
        <Panel title="Real holders" vals={rows.map((r) => r[1])} idx={idx} partial={partial} height={150} strong />
        <Panel title="All holders" vals={rows.map((r) => r[2])} idx={idx} partial={partial} height={84} />
        <div className="hh-x" aria-hidden="true">
          {xLabels(rows.map((r) => r[0]), partial).map(({ i, text, wide, today }) => {
            const at = n > 1 ? (i / (n - 1)) * 100 : 50;
            const cls = [at < 6 ? 'hh-x-start' : at > 94 ? 'hh-x-end' : '', wide ? 'hh-x-wide' : ''].filter(Boolean).join(' ');
            return (
              <span key={i} className={cls || undefined} style={{ left: `${at}%` }}>{text}{today && <span className="hh-x-long"> so far</span>}</span>
            );
          })}
        </div>
      </div>
      <span className="sr" aria-live="polite">{spoken}</span>
    </figure>
  );
}
