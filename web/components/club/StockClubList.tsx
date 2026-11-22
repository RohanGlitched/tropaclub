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

const line = (r: StockClubRow) =>
  r.supporters > 0
    ? `${fmtInt(r.supporters)} ${r.supporters === 1 ? 'member' : 'members'}, ${fmtInt(r.playing)} bought this week · ${fmtInt(r.realFans)} real holders of the token`
    : r.realFans > 0
      ? `0 members yet · ${fmtInt(r.realFans)} real holders of the token`
      : '0 members yet · anyone can join';

/** Open clubs, one per stock token: the biggest grounds first, the rest behind "All N". Never a wall of zeros. */
export default function StockClubList({ rows, first = 12 }: { rows: StockClubRow[]; first?: number }) {
  const card = (r: StockClubRow) => (
    <Link key={r.symbol} href={`/club/stock-${r.symbol.toLowerCase()}`} className="club-card" prefetch={false}>
      <Pennant kit={kitFor(r.symbol)} width={30} />
      <span>
        <b>{openClubName(r.name, r.symbol)}</b>
        <small>{line(r)}</small>
      </span>
    </Link>
  );
  const head = rows.slice(0, first);
  const rest = rows.slice(first);
  return (
    <>
      <div className="club-grid">{head.map(card)}</div>
      {rest.length > 0 && (
        <details className="more-clubs">
          <summary>All {rows.length} open clubs</summary>
          <div className="club-grid">{rest.map(card)}</div>
        </details>
      )}
    </>
  );
}
