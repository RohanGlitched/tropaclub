import Link from 'next/link';
import type { MoverRow, MoversFile, NotableLine } from '@shared/types';
import { Pennant } from '@/components/ds/Pennant';
import Anchor from '@/components/nav/Anchor';
import { groundPath, kitFor, shortName } from '@/lib/clubs';
import { fmtDate, fmtInt, fmtPct } from '@/lib/format';

/** A notable sentence, with its ground's ticker linked when the sentence starts with it. */
export function NotableText({ line }: { line: NotableLine }) {
  const s = line.symbol;
  if (s && line.text.startsWith(s)) {
    return <><Link href={groundPath(s)} prefetch={false}>{s}</Link>{line.text.slice(s.length)}</>;
  }
  return <>{line.text}</>;
}

function Row({ r, value, note }: { r: MoverRow; value: string; note: string }) {
  return (
    <li>
      <Link href={groundPath(r.symbol)} prefetch={false} className="mv-row">
        <Pennant kit={kitFor(r.symbol)} width={14} />
        <span className="mv-name">{shortName(r.name, r.symbol)} <small>{r.symbol}</small></span>
        <span className="mv-val num">{value}</span>
      </Link>
      <small className="mv-note num">{note}</small>
    </li>
  );
}

/** "This week's movers": top 5 by new real holders and by % rise over the 7-day window. Facts only. */
export default function MoversStrip({ movers }: { movers: MoversFile }) {
  const w = movers.windows.find((x) => x.window === '7d');
  if (!w) return null;
  const byNew = w.byNewRealFans.slice(0, 5);
  const byPct = w.byChangePct.filter((r) => (r.changePct ?? 0) > 0).slice(0, 5);
  if (!byNew.length && !byPct.length) return null;
  const since = fmtDate(w.from);
  // the two list leaders already have their own row, so their sentences are not repeated
  const shown = new Set([byNew.length ? 'top-new-7d' : '', byPct.length ? 'top-pct-7d' : '']);
  const notes = movers.notable.filter((n) => (n.window === '7d' || n.window === 'now') && !shown.has(n.key)).slice(0, 6);

  return (
    <section className="wrap movers" id="movers" aria-labelledby="movers-h">
      <div className="movers-head">
        <h2 className="h3" id="movers-h">This week&rsquo;s movers<Anchor id="movers" label="This week’s movers" /></h2>
        <p className="asof">Last 7 days: {fmtDate(w.from, true)} to {fmtDate(w.to, true)}. Counts of real holders, not prices.</p>
      </div>
      <div className="movers-grid">
        {byNew.length > 0 && (
          <div>
            <h3 className="movers-title">Most new real holders</h3>
            <ol className="movers-list">
              {byNew.map((r) => (
                <Row key={r.symbol} r={r} value={`+${fmtInt(r.newRealFans)}`} note={r.realFansThen === 0 ? `New ground this week, ${fmtInt(r.realFansNow)} real holders now` : `${fmtInt(r.realFansNow)} real holders now, ${fmtInt(r.realFansThen)} on ${since}`} />
              ))}
            </ol>
            <p className="muted small">A new real holder is a real holder today who first received that token after {since}.</p>
          </div>
        )}
        {byPct.length > 0 && (
          <div>
            <h3 className="movers-title">Biggest rise in real holders</h3>
            <ol className="movers-list">
              {byPct.map((r) => (
                <Row key={r.symbol} r={r} value={`+${fmtPct(r.changePct, r.changePct! >= 100 ? 0 : 1)}`} note={`From ${fmtInt(r.realFansThen)} to ${fmtInt(r.realFansNow)} real holders`} />
              ))}
            </ol>
            <p className="muted small">Only grounds that had at least {fmtInt(w.pctMinBase)} real holders on {since} count for the % rise.</p>
          </div>
        )}
      </div>
      {notes.length > 0 && (
        <ul className="movers-notes">
          {notes.map((n) => (
            <li key={n.key}><NotableText line={n} /></li>
          ))}
        </ul>
      )}
      <p className="asof">As of {fmtDate(movers.asOf, true)}.</p>
    </section>
  );
}

/** One live line for the home page, dated. */
export function HomeNotable({ line, asOf }: { line: NotableLine; asOf: string }) {
  const tag = line.window === '7d' ? 'This week' : line.window === '24h' ? 'Last 24 hours' : 'Now';
  return (
    <div className="wrap live-line-wrap">
      <p className="live-line">
        <span className="tag tag-quiet">{tag}</span>
        <span><NotableText line={line} /> <span className="muted small">As of {fmtDate(asOf, true)}.</span> <Link href="/attendance#movers" prefetch={false}>This week&rsquo;s movers</Link></span>
      </p>
    </div>
  );
}
