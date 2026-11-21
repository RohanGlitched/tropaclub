import type { StatsFile } from '@shared/types';
import { fmtDate, fmtInt } from '@/lib/format';

/** Weekly buyers: returning and first-time, stacked. Plain bars with direct labels and a table fallback. */
export default function WeeklyChart({ weeks }: { weeks: StatsFile['weeklyBuyers'] }) {
  const data = weeks.slice(-6);
  if (!data.length) return <p className="muted">Weekly buyer counts are not published yet.</p>;
  const max = Math.max(...data.map((w) => w.buyers), 1);
  const H = 170;
  const bw = 64;
  const gap = 34;
  const W = data.length * (bw + gap) - gap;
  return (
    <figure className="weekly">
      <svg viewBox={`0 0 ${W} ${H + 48}`} role="img" aria-label={`Wallets that bought a stock token each week: ${data.map((w) => `${fmtInt(w.buyers)} in the week of ${fmtDate(w.weekStart)}`).join(', ')}.`}>
        {data.map((w, i) => {
          const x = i * (bw + gap);
          const h = (w.buyers / max) * H;
          const hn = (Math.min(w.newBuyers, w.buyers) / max) * H;
          return (
            <g key={w.weekStart}>
              <rect x={x} y={H - h + 22} width={bw} height={Math.max(0, h - hn - 2)} className="bar-ret" />
              <rect x={x} y={H - hn + 22} width={bw} height={hn} className="bar-new" />
              <text x={x + bw / 2} y={H - h + 14} textAnchor="middle" className="bar-val">{fmtInt(w.buyers)}</text>
              <text x={x + bw / 2} y={H + 42} textAnchor="middle" className="bar-lab">{fmtDate(w.weekStart).replace(/ \d{4}$/, '')}</text>
            </g>
          );
        })}
      </svg>
      <figcaption>
        <span><i className="sw sw-ret" />Bought before</span>
        <span><i className="sw sw-new" />First-ever buy</span>
        <span className="muted">Week starting. Bots with over 50 swaps removed.</span>
      </figcaption>
    </figure>
  );
}
