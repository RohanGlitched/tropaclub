/**
 * Payday streak (badge only, never a prize): one >= $5 qualifying buy in any rolling 14 days keeps it.
 * One free skip per calendar month (UTC): a gap of up to 28 days survives if the month in which the
 * missed 14-day deadline fell has not used its skip yet.
 */
import { DAY } from './util';

export interface PaydayStreak {
  alive: boolean;
  /** Qualifying buys in the current run (same-day buys count once). */
  paydays: number;
  since: number | null;
  lastBuyAt: number | null;
  /** Buy by this time to keep the streak without spending a skip. */
  dueBy: number | null;
  /** Latest time the streak survives if this month's skip is still free. */
  graceUntil: number | null;
  skipsUsed: string[]; // "2026-12"
  skipAvailableThisMonth: boolean;
  badge: string | null;
}

const month = (t: number) => new Date(t * 1000).toISOString().slice(0, 7);
const dayKey = (t: number) => Math.floor(t / DAY);

export function paydayStreak(buyTimes: number[], now: number, windowDays = 14): PaydayStreak {
  const W = windowDays * DAY;
  const times = [...buyTimes].filter((t) => t <= now).sort((a, b) => a - b);
  if (!times.length)
    return { alive: false, paydays: 0, since: null, lastBuyAt: null, dueBy: null, graceUntil: null, skipsUsed: [], skipAvailableThisMonth: true, badge: null };

  let since = times[0]!;
  let days = new Set([dayKey(since)]);
  let skips = new Set<string>();
  let prev = since;
  for (const t of times.slice(1)) {
    const gap = t - prev;
    if (gap <= W) {
      /* kept */
    } else if (gap <= 2 * W && !skips.has(month(prev + W))) {
      skips.add(month(prev + W));
    } else {
      since = t;
      days = new Set();
      skips = new Set();
    }
    days.add(dayKey(t));
    prev = t;
  }
  const last = prev;
  const missMonth = month(last + W);
  let alive = now - last <= W;
  if (!alive && now - last <= 2 * W && !skips.has(missMonth)) {
    alive = true; // riding this month's free skip
  }
  const paydays = alive ? days.size : 0;
  return {
    alive,
    paydays,
    since: alive ? since : null,
    lastBuyAt: last,
    dueBy: last + W,
    graceUntil: skips.has(missMonth) ? last + W : last + 2 * W,
    skipsUsed: [...skips].sort(),
    skipAvailableThisMonth: !skips.has(month(now)),
    badge: alive ? streakBadge(paydays) : null,
  };
}

export function streakBadge(paydays: number): string | null {
  if (paydays <= 0) return null;
  if (paydays === 1) return 'First payday';
  if (paydays < 4) return `Payday streak · ${paydays}`;
  if (paydays < 8) return `Regular · ${paydays} paydays`;
  return `Ever-present · ${paydays} paydays`;
}
