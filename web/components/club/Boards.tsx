// The Caps and Top scouts tables on /league. Server-rendered, one page of rows at a time; the same
// league-table look as the club tables (cards on phones). Names only: a nickname or a short address.
import Link from 'next/link';
import { fmtDate, fmtInt } from '@/lib/format';

export const BOARD_PAGE = 50;

export interface CapsBoardRow { rank: number; name: string; caps: number; firstBuyAt: number | null }
export interface ScoutsBoardRow { rank: number; name: string; stillHolding: number; credited: number; badge: string | null }

const Name = ({ name }: { name: string }) => <span className={`board-name${name.startsWith('0x') ? ' num' : ''}`}>{name}</span>;

export function CapsBoard({ rows }: { rows: CapsBoardRow[] }) {
  return (
    <table className="league-table">
      <caption className="sr">Caps table: season Caps by wallet</caption>
      <thead>
        <tr>
          <th scope="col" className="c-pos">Pos</th>
          <th scope="col" className="c-club">Name</th>
          <th scope="col" className="r">Caps</th>
          <th scope="col" className="r">First buy</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.rank}>
            <td className="c-pos num">{r.rank}</td>
            <th scope="row" className="c-club"><Name name={r.name} /></th>
            <td className="r num c-strong" data-label="Caps">{r.caps.toFixed(2)}</td>
            <td className="r num" data-label="First buy">{r.firstBuyAt ? fmtDate(r.firstBuyAt) : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ScoutsBoard({ rows }: { rows: ScoutsBoardRow[] }) {
  return (
    <table className="league-table">
      <caption className="sr">Top scouts: credited mates still holding</caption>
      <thead>
        <tr>
          <th scope="col" className="c-pos">Pos</th>
          <th scope="col" className="c-club">Name</th>
          <th scope="col" className="r">Still holding</th>
          <th scope="col" className="r">Credited mates</th>
          <th scope="col" className="r">Badge</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.rank}>
            <td className="c-pos num">{r.rank}</td>
            <th scope="row" className="c-club"><Name name={r.name} /></th>
            <td className="r num c-strong" data-label="Still holding">{fmtInt(r.stillHolding)}</td>
            <td className="r num" data-label="Credited mates">{fmtInt(r.credited)}</td>
            <td className="r" data-label="Badge">{r.badge ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** "Showing 51 to 100 of 340", with previous and next links. */
export function BoardPager({ tab, page, total }: { tab: string; page: number; total: number }) {
  const pages = Math.max(1, Math.ceil(total / BOARD_PAGE));
  if (pages <= 1) return null;
  const from = (page - 1) * BOARD_PAGE + 1;
  const to = Math.min(total, page * BOARD_PAGE);
  const href = (p: number) => `/league?tab=${tab}${p > 1 ? `&page=${p}` : ''}`;
  return (
    <nav className="board-pager" aria-label="Table pages">
      {page > 1 && <Link className="btn btn-sm" href={href(page - 1)} prefetch={false} rel="prev">Previous {BOARD_PAGE}</Link>}
      <span className="num">Showing {fmtInt(from)} to {fmtInt(to)} of {fmtInt(total)}</span>
      {page < pages && <Link className="btn btn-sm" href={href(page + 1)} prefetch={false} rel="next">Next {BOARD_PAGE}</Link>}
    </nav>
  );
}
