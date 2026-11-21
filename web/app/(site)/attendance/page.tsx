import type { Metadata } from 'next';
import Link from 'next/link';
import AttendanceTable from '@/components/AttendanceTable';
import SeatSearchBox from '@/components/SeatSearchBox';
import { Pennant } from '@/components/ds/Pennant';
import { dataBaseUrl, getIndex, getStats } from '@/lib/server/data';
import { clubName, groundPath, kitFor } from '@/lib/clubs';
import { fmtDate, fmtInt, fmtPct } from '@/lib/format';

export const revalidate = 300;
export const metadata: Metadata = {
  title: 'The Attendance: real holders of every stock token on Base',
  description: 'A league table of stock tokens on Base, ranked by the fans who really showed up: tickets sold, real fans, attendance, weekly buyers and new buyers.',
};

export default async function AttendancePage() {
  const [{ data: index, source }, { data: stats }] = await Promise.all([getIndex(), getStats()]);
  const tokens = index.tokens;
  const priced = tokens.filter((t) => t.priceUsd != null);
  const sold = tokens.reduce((a, t) => a + t.holdersTotal, 0);
  const fans = tokens.reduce((a, t) => a + t.realFans, 0);
  const best = [...priced].filter((t) => t.holdersTotal >= 200).sort((a, b) => b.attendancePct - a.attendancePct)[0];
  const busiest = [...tokens].sort((a, b) => b.weeklyBuyers - a.weeklyBuyers)[0];
  const emptiest = [...priced].filter((t) => t.holdersTotal >= 1000).sort((a, b) => a.attendancePct - b.attendancePct)[0];
  const stack = tokens.slice(0, 10);

  return (
    <>
      <main id="main">
        <section className="wrap page-head">
          <h1>The Attendance</h1>
          <p className="lede">
            {tokens.length} stock tokens on Base, ranked by the fans who showed up. Across every ground, <span className="num">{fmtInt(sold)}</span> tickets are sold and <span className="num">{fmtInt(fans)}</span> seats hold a real fan: an attendance of {fmtPct((fans / Math.max(1, sold)) * 100)}.
          </p>
          <p className="asof">Counted {fmtDate(index.asOf, true)}{index.block ? `, Base block ${fmtInt(index.block)}` : ''}. Past performance · not advice.</p>
        </section>

        <section className="wrap section-tight" aria-label="League table">
          <AttendanceTable rows={tokens} />
        </section>

        <section className="band">
          <div className="wrap">
            <div className="section-head">
              <h2>Three things the table shows</h2>
            </div>
            <ul className="limits limits-3">
              {best && (
                <li>
                  <h3>Fullest ground</h3>
                  <p><Link href={groundPath(best.symbol)}>{clubName(best.name)}</Link> fills {fmtPct(best.attendancePct)} of its seats: {fmtInt(best.realFans)} fans from {fmtInt(best.holdersTotal)} tickets. Small crowds can be loyal ones.</p>
                </li>
              )}
              {emptiest && (
                <li>
                  <h3>Most ghosts</h3>
                  <p><Link href={groundPath(emptiest.symbol)}>{clubName(emptiest.name)}</Link> has {fmtInt(emptiest.holdersTotal)} tickets out and {fmtPct(emptiest.attendancePct)} attendance. Tickets are easy to hand out. Seats are harder to fill.</p>
                </li>
              )}
              {busiest && (
                <li>
                  <h3>Busiest turnstiles</h3>
                  <p><Link href={groundPath(busiest.symbol)}>{clubName(busiest.name)}</Link> saw {fmtInt(busiest.weeklyBuyers)} wallets buy in the last seven days, {fmtInt(busiest.newBuyers7d)} of them for the first time.</p>
                </li>
              )}
            </ul>
          </div>
        </section>

        <section className="wrap section">
          <div className="section-head">
            <h2>Who fills the ten biggest grounds</h2>
            <p>Each bar is every ticket sold for one club, split by who holds it. The coloured part is the crowd.</p>
          </div>
          <div className="stacks">
            {stack.map((t) => {
              const kit = kitFor(t.symbol);
              const total = Math.max(1, t.holdersTotal);
              return (
                <Link key={t.symbol} href={groundPath(t.symbol)} className="stack-row" prefetch={false}>
                  <span className="stack-name"><Pennant kit={kit} width={16} />{clubName(t.name)}</span>
                  <span className="stack-bar" role="img" aria-label={`${fmtInt(t.realFans)} real fans, ${fmtInt(t.ghosts.dust)} dust, ${fmtInt(t.ghosts.farmerOnly)} farmer-only, ${fmtInt(t.ghosts.contracts)} contracts`}>
                    <i style={{ width: `${(t.realFans / total) * 100}%`, background: kit.primary }} />
                    <i className="gate-dust" style={{ width: `${(t.ghosts.dust / total) * 100}%` }} />
                    <i className="gate-farmer" style={{ width: `${(t.ghosts.farmerOnly / total) * 100}%` }} />
                    <i className="gate-contract" style={{ width: `${(t.ghosts.contracts / total) * 100}%` }} />
                  </span>
                  <span className="stack-val num">{fmtPct(t.attendancePct)}</span>
                </Link>
              );
            })}
          </div>
          <p className="stack-key">
            <span><i className="sw sw-fan" />Real fans</span>
            <span><i className="sw sw-dust" />Dust</span>
            <span><i className="sw sw-farmer" />Farmer-only</span>
            <span><i className="sw sw-contract" />Contracts</span>
          </p>
        </section>

        <section className="band">
          <div className="wrap split">
            <div className="split-text">
              <h2>How to read it</h2>
              <dl className="defs">
                <div><dt>Tickets sold</dt><dd>Every wallet with a balance above zero. The number an explorer calls &ldquo;holders&rdquo;.</dd></div>
                <div><dt>Real fans</dt><dd>Wallets holding $10 or more that belong to a person and did more than receive a giveaway.</dd></div>
                <div><dt>Attendance</dt><dd>Real fans divided by tickets sold.</dd></div>
                <div><dt>Buyers, 7 days</dt><dd>Distinct wallets that bought on a DEX in the last week. Bots with more than 50 swaps are left out.</dd></div>
                <div><dt>New buyers, 7 days</dt><dd>Of those, wallets buying that token for the first time.</dd></div>
                <div><dt>No price yet</dt><dd>Tokens without a liquid market have no dollar value, so the $10 line cannot be drawn. Their tickets are counted and their fans are not.</dd></div>
              </dl>
              <p><Link href="/about#method">The full method</Link></p>
            </div>
            <div className="split-text" id="feed">
              <h2>Free JSON feed</h2>
              <p>The table is a public file, rewritten at every count. Use it in a dashboard, a bot or a research note. No key, no sign-up.</p>
              <pre className="code" tabIndex={0}><code>GET {dataBaseUrl}/index.json{'\n'}GET {dataBaseUrl}/tokens/NVDAc.json{'\n'}GET {dataBaseUrl}/stats.json</code></pre>
              <p className="muted small">{source === 'mock' ? 'The first files are published with the indexer’s first run. Until then this page shows sample data.' : `Last written ${fmtDate(index.asOf, true)}.`} Please credit Tropa Club.</p>
              <h3>Is your wallet in the table?</h3>
              <SeatSearchBox label="Paste a wallet" button="Find seat" />
            </div>
          </div>
        </section>

        <section className="wrap section">
          <div className="section-head">
            <h2>Limits</h2>
          </div>
          <ul className="limits limits-3">
            <li><h3>Counts, not people</h3><p>{fmtInt(stats.realWallets)} distinct wallets hold a real seat somewhere. One person can stand behind several of them.</p></li>
            <li><h3>A snapshot</h3><p>Positions move with every count and with the token price. The date above is the only moment this table is true for.</p></li>
            <li><h3>Not a ranking of stocks</h3><p>Attendance measures holders, not the company or the price. Nothing here is a reason to buy or sell.</p></li>
          </ul>
        </section>
      </main>
    </>
  );
}
