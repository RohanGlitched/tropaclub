'use client';

import { useEffect, useState } from 'react';

const pad = (n: number) => String(n).padStart(2, '0');

function parts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

/**
 * A small live countdown to `at`: "in 2d 05h 14m 09s". The server renders the same text from its
 * own clock, so the first paint already has it; the digits are tabular and the box has a fixed
 * minimum width, so ticking never moves anything. With reduced motion it drops the seconds and
 * changes once a minute.
 */
export default function Countdown({ at, now }: { at: string; now: number }) {
  const target = Date.parse(at);
  const [t, setT] = useState(now);
  const [seconds, setSeconds] = useState(true);
  useEffect(() => {
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setSeconds(!calm);
    setT(Date.now());
    const id = setInterval(() => setT(Date.now()), calm ? 60_000 : 1000);
    return () => clearInterval(id);
  }, []);
  const ms = target - t;
  if (ms <= 0) return <span className="countdown" suppressHydrationWarning>now open</span>;
  const p = parts(ms);
  const text = `${p.d}d ${pad(p.h)}h ${pad(p.m)}m${seconds ? ` ${pad(p.s)}s` : ''}`;
  const spoken = `Opens in ${p.d} ${p.d === 1 ? 'day' : 'days'}, ${p.h} ${p.h === 1 ? 'hour' : 'hours'} and ${p.m} ${p.m === 1 ? 'minute' : 'minutes'}`;
  return (
    <span className="countdown" role="timer" aria-label={spoken} suppressHydrationWarning>
      <span aria-hidden="true">in </span>
      <span className="num countdown-n" aria-hidden="true" suppressHydrationWarning>{text}</span>
    </span>
  );
}
