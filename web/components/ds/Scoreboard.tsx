'use client';

import type { ReactNode } from 'react';

/**
 * Split-flap number. Each digit is keyed by its value, so a changed digit remounts and its flap falls.
 * Reduced motion: the global rule removes the animation and the new digit simply appears.
 */
export function FlipNumber({ value, pad = 1, label }: { value: number | string; pad?: number; label?: string }) {
  const text = typeof value === 'number' ? String(Math.round(value)).padStart(pad, '0') : value;
  const chars = text.split('');
  return (
    <span className="flip num" role="img" aria-label={label ?? text}>
      {chars.map((ch, i) => (
        <span key={`${i}-${ch}`} className={/\d/.test(ch) ? 'flip-d' : 'flip-s'} style={{ animationDelay: `${(chars.length - 1 - i) * 70}ms` }} aria-hidden="true">
          {ch}
        </span>
      ))}
    </span>
  );
}

export interface ScoreCell {
  label: string;
  value: number | string;
  pad?: number;
}

/**
 * The broadcast-style scoreboard. Always a night graphic: Midnight board, Chalk digits, one Marigold rule.
 * It shows counts of people and weeks. It never shows returns.
 */
export default function Scoreboard({ title, kicker, cells, foot }: { title: string; kicker?: string; cells: ScoreCell[]; foot?: ReactNode }) {
  return (
    <section className="scoreboard" aria-label={title}>
      <header>
        <b>{title}</b>
        {kicker && <span>{kicker}</span>}
      </header>
      <dl>
        {cells.map((c) => (
          <div key={c.label}>
            <dd><FlipNumber value={c.value} pad={c.pad} /></dd>
            <dt>{c.label}</dt>
          </div>
        ))}
      </dl>
      {foot && <footer>{foot}</footer>}
    </section>
  );
}
