import Link from 'next/link';
import { Pennant } from '@/components/ds/Pennant';
import { clubName, kitFor } from '@/lib/clubs';
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
    ? `${fmtInt(r.supporters)} ${r.supporters === 1 ? 'supporter' : 'supporters'}, ${fmtInt(r.playing)} playing · ${fmtInt(r.realFans)} real fans in the ground`
    : r.realFans > 0
      ? `${fmtInt(r.realFans)} real fans in the ground · be the first supporter`
      : 'Be the first supporter';

/** Stock clubs: the biggest crowds first, the rest behind "All N". Never a wall of zeros. */
export default function StockClubList({ rows, first = 12 }: { rows: StockClubRow[]; first?: number }) {
  const card = (r: StockClubRow) => (
    <Link key={r.symbol} href={`/club/stock-${r.symbol.toLowerCase()}`} className="club-card" prefetch={false}>
      <Pennant kit={kitFor(r.symbol)} width={30} />
      <span>
        <b>{clubName(r.name)}</b>
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
          <summary>All {rows.length} stock clubs</summary>
          <div className="club-grid">{rest.map(card)}</div>
        </details>
      )}
    </>
  );
}
