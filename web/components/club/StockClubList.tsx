import Link from 'next/link';
import { Pennant } from '@/components/ds/Pennant';
import { kitFor } from '@/lib/clubs';
import { openClubName } from '@/lib/site';
import { fmtInt } from '@/lib/format';

export interface StockClubRow {
  symbol: string;
  name: string;
  realFans: number;
  supporters: number;
  playing: number;
}

const href = (r: StockClubRow) => `/club/stock-${r.symbol.toLowerCase()}`;

/**
 * Open clubs, one per stock token, biggest grounds first. Clubs with members get a card each.
 * Clubs nobody has joined yet share one dense list (the first `first`, the rest behind "See all"),
 * so the page never shows a wall of identical "0 members" rows.
 */
export default function StockClubList({ rows, first = 12 }: { rows: StockClubRow[]; first?: number }) {
  const joined = rows.filter((r) => r.supporters > 0);
  const empty = rows.filter((r) => r.supporters === 0);
  const item = (r: StockClubRow) => (
    <li key={r.symbol}>
      <Link href={href(r)} prefetch={false}>
        <Pennant kit={kitFor(r.symbol)} width={16} />
        <b>{openClubName(r.name, r.symbol)}</b>
        <small className="num">{r.realFans > 0 ? `${fmtInt(r.realFans)} real holders` : r.symbol}</small>
      </Link>
    </li>
  );
  const head = empty.slice(0, first);
  const rest = empty.slice(first);
  return (
    <>
      {joined.length > 0 && (
        <div className="club-grid">
          {joined.map((r) => (
            <Link key={r.symbol} href={href(r)} className="club-card" prefetch={false}>
              <Pennant kit={kitFor(r.symbol)} width={30} />
              <span>
                <b>{openClubName(r.name, r.symbol)}</b>
                <small>{fmtInt(r.supporters)} {r.supporters === 1 ? 'member' : 'members'}, {fmtInt(r.playing)} bought this week · {fmtInt(r.realFans)} real holders of the token</small>
              </span>
            </Link>
          ))}
        </div>
      )}
      {empty.length > 0 && (
        <div className="open-clubs">
          <p className="open-clubs-note">
            {joined.length ? `No one has joined these ${fmtInt(empty.length)} yet.` : `No one has joined an open club yet.`} Joining is free. The number is the token&rsquo;s real holders, who are counted whether or not they join.
          </p>
          <ul className="open-list">{head.map(item)}</ul>
          {rest.length > 0 && (
            <details className="more-clubs">
              <summary>See all {fmtInt(empty.length)} open clubs</summary>
              <ul className="open-list">{rest.map(item)}</ul>
            </details>
          )}
        </div>
      )}
    </>
  );
}
