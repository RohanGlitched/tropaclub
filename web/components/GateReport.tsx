import type { TokenSummary } from '@shared/types';
import { fmtInt, fmtPct } from '@/lib/format';
import { kitFor } from '@/lib/clubs';

/** The turnstile count for one club: tickets sold, split into who is really there. */
export default function GateReport({ token }: { token: TokenSummary }) {
  const total = Math.max(1, token.holdersTotal);
  const kit = kitFor(token.symbol);
  const rows = [
    { key: 'real', label: 'Real fans', n: token.realFans, note: 'Hold $10 or more, bought it themselves, and are a person’s wallet.' },
    { key: 'dust', label: 'Dust', n: token.ghosts.dust, note: 'Hold less than $10. Mostly leftovers worth cents.' },
    { key: 'farmer', label: 'Farmer-only', n: token.ghosts.farmerOnly, note: 'Only ever received tokens from a giveaway contract. Never bought.' },
    { key: 'contract', label: 'Contracts', n: token.ghosts.contracts, note: 'Pools, vaults and routers. Code, not people.' },
  ];
  return (
    <div className="gate">
      <div className="gate-bar" role="img" aria-label={`${fmtInt(token.realFans)} real fans out of ${fmtInt(token.holdersTotal)} tickets sold`}>
        {rows.map((r) => (
          <span key={r.key} className={`gate-seg gate-${r.key}`} style={{ flexGrow: Math.max(r.n, 0.0001), background: r.key === 'real' ? kit.primary : undefined }} />
        ))}
      </div>
      <table className="gate-table">
        <caption className="sr">Tickets sold at {token.name} FC, by kind of holder</caption>
        <thead>
          <tr>
            <th scope="col">Turnstile</th>
            <th scope="col" className="r">Seats</th>
            <th scope="col" className="r">Share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={r.key === 'real' ? 'is-real' : undefined}>
              <th scope="row">
                <i className={`sw ${r.key === 'real' ? '' : `sw-${r.key}`}`} style={r.key === 'real' ? { background: kit.primary } : undefined} />
                <span>
                  {r.label}
                  <small>{r.note}</small>
                </span>
              </th>
              <td className="r num">{fmtInt(r.n)}</td>
              <td className="r num">{fmtPct((r.n / total) * 100)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Tickets sold</th>
            <td className="r num">{fmtInt(token.holdersTotal)}</td>
            <td className="r num">100%</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
