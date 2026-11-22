import type { GroundHistory as History } from '@/lib/server/data';
import HistoryChart, { type DayRow } from '@/components/HistoryChart';
import Anchor from '@/components/nav/Anchor';
import Term from '@/components/nav/Term';
import { fmtDate, fmtInt, fmtPct } from '@/lib/format';

const signed = (n: number) => (n > 0 ? `+${fmtInt(n)}` : n < 0 ? `−${fmtInt(-n)}` : '0');
const signedPct = (n: number) => (n > 0 ? `+${fmtPct(n)}` : n < 0 ? `−${fmtPct(-n)}` : '0%');

/** "Real holders over time": the daily count since the ground opened, with a 7-day change line. */
export default function GroundHistory({ history, symbol, club }: { history: History; symbol: string; club: string }) {
  const { points, partial, week, gaps, asOf } = history;
  const rows: DayRow[] = points.map((p) => [p.day, p.real, p.holders]);
  const first = points[0].day;
  const last = points[points.length - 1];
  const opened = week && week.then === 0 && first > week.thenDay;
  const label = `Real holders and all holders of ${symbol} by day, ${fmtDate(first)} to ${fmtDate(last.day)}${partial ? ' (today so far)' : ''}.${last.real != null && last.holders != null ? ` Latest: ${fmtInt(last.real)} real holders of ${fmtInt(last.holders)}.` : ''}`;

  return (
    <section className="wrap section ground-history" id="history" aria-labelledby="history-h">
      <div className="section-head">
        <h2 id="history-h">Real holders over time<Anchor id="history" label="Real holders over time" /></h2>
        <p>
          The {club} counted at the end of every day (UTC) since it opened on {fmtDate(first)}. The top line is <Term id="real-fan">real holders</Term>; the lower one is every wallet with a balance. Point at a day, tap it or use the arrow keys to read it.
        </p>
        {week && (
          <p className="hh-week">
            <span className="tag tag-quiet">7 days</span>
            <b className="num">{signed(week.diff)}</b> real holders
            {week.pct != null && <> (<span className="num">{signedPct(week.pct)}</span>)</>} since the end of {fmtDate(week.thenDay)}
            {opened ? <>, when there were none: the ground opened on {fmtDate(first)}.</> : <>: from <span className="num">{fmtInt(week.then)}</span> to <span className="num">{fmtInt(week.now)}</span>.</>}
          </p>
        )}
      </div>
      <HistoryChart rows={rows} partial={partial} label={label} />
      <p className="asof">
        As of {fmtDate(asOf, true)}.{partial ? ' The last day is today so far, counted at that time.' : ''}{gaps > 0 ? ` The ${gaps === 1 ? 'gap is a day' : `${gaps} gaps are days`} with no count, not a zero.` : ''}
      </p>
      <details className="hh-details">
        <summary>The numbers by day</summary>
        <div className="hh-scroll" tabIndex={0} role="region" aria-label={`${symbol} holders by day`}>
          <table className="hh-table">
            <caption className="sr">Real holders and all holders of {symbol} by day, newest first. As of {fmtDate(asOf, true)}.</caption>
            <thead>
              <tr><th scope="col">Day (UTC)</th><th scope="col" className="r">Real holders</th><th scope="col" className="r">All holders</th><th scope="col" className="r">Real share</th></tr>
            </thead>
            <tbody>
              {[...points].reverse().map((p, k) => (
                <tr key={p.day}>
                  <th scope="row">{fmtDate(p.day)}{partial && k === 0 ? ', so far' : ''}</th>
                  {p.real == null || p.holders == null ? (
                    <td className="r muted" colSpan={3}>No count</td>
                  ) : (
                    <>
                      <td className="r num">{fmtInt(p.real)}</td>
                      <td className="r num">{fmtInt(p.holders)}</td>
                      <td className="r num">{p.holders ? fmtPct((p.real / p.holders) * 100) : '—'}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
