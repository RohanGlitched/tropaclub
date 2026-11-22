import Countdown from './Countdown';
import { fmtInt } from '@/lib/format';
import { utcWhen } from '@/lib/site';

/**
 * The pre-season line that stands in for "0 members" and "no clubs yet" until buying opens:
 * "Opens Tue Nov 24, 14:30 UTC · 1,625 real holders could join · in 1d 22h 05m 10s".
 * `holders` is a live count from the index (a token's real holders, or real-holder wallets overall).
 */
export default function PreSeason({ openAt, holders, className }: { openAt: string; holders: number; className?: string }) {
  return (
    <p className={`preseason${className ? ` ${className}` : ''}`}>
      <span>Opens {utcWhen(openAt)}</span>
      <span aria-hidden="true"> · </span>
      <span><span className="num">{fmtInt(holders)}</span> real holders could join</span>
      <span aria-hidden="true"> · </span>
      <Countdown at={openAt} now={Date.now()} />
    </p>
  );
}
