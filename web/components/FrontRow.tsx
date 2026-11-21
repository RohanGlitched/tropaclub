'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useSeats } from '@/lib/client';
import { fmtDate, fmtInt, shortAddr } from '@/lib/format';
import { seatLabel } from '@/lib/stadium';

/** The first ten fans by rank, and a few facts about the crowd, from the seat list. */
export default function FrontRow({ symbol, club, total, realFans, seatsBase }: { symbol: string; club: string; total: number; realFans: number; seatsBase?: string | null }) {
  const s = useSeats(symbol, true, seatsBase);
  const real = useMemo(() => s.seats.slice(0, Math.min(realFans, s.seats.length)).filter((x) => x.k === 'real'), [s.seats, realFans]);
  const facts = useMemo(() => {
    if (!real.length) return null;
    const days = real.map((x) => x.holdDays).sort((a, b) => a - b);
    const median = days[Math.floor(days.length / 2)];
    const gap = real.filter((x) => x.heldThroughGap).length;
    const streak = real.filter((x) => x.streakWeeks >= 2).length;
    return { longest: days[days.length - 1], median, gapPct: (gap / real.length) * 100, streak };
  }, [real]);

  if (s.status === 'loading') {
    return (
      <div className="front" aria-busy="true">
        <ol className="front-list">
          {Array.from({ length: 10 }, (_, i) => (
            <li key={i} className="skeleton-row"><span /><span /><span /></li>
          ))}
        </ol>
      </div>
    );
  }
  if (s.status === 'missing' || !real.length) {
    return (
      <p className="notice">
        The seat-by-seat list for {club} is not published yet, so the front row cannot be named. The totals above are complete. Check back after the next count.
      </p>
    );
  }
  return (
    <div className="front">
      <ol className="front-list">
        {real.slice(0, 10).map((x, i) => {
          const l = seatLabel(total, i);
          return (
            <li key={x.a}>
              <span className="front-rank num">{i + 1}</span>
              <span className="front-who">
                <Link href={`/ticket/${x.a}`} className="num" prefetch={false}>{shortAddr(x.a)}</Link>
                <small>Block {l?.block}, row {l?.row}, seat {l?.seat}</small>
              </span>
              <span className="front-held">
                <b className="num">{fmtInt(x.holdDays)} days</b>
                <small>since {fmtDate(x.firstBuy)}</small>
              </span>
            </li>
          );
        })}
      </ol>
      {facts && (
        <dl className="front-facts">
          <div><dt>Longest unbroken hold</dt><dd className="num">{fmtInt(facts.longest)} days</dd></div>
          <div><dt>Median hold among fans</dt><dd className="num">{fmtInt(facts.median)} days</dd></div>
          <div><dt>Held through a weekend gap</dt><dd className="num">{facts.gapPct.toFixed(0)}% of fans</dd></div>
          <div><dt>Bought two weeks running or more</dt><dd className="num">{fmtInt(facts.streak)} fans</dd></div>
        </dl>
      )}
    </div>
  );
}
