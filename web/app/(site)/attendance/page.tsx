import type { Metadata } from 'next';
import Link from 'next/link';
import AttendanceTable from '@/components/AttendanceTable';
import SeatSearchBox from '@/components/SeatSearchBox';
import { Pennant } from '@/components/ds/Pennant';
import Term from '@/components/nav/Term';
import { Crumbs, NextStrip } from '@/components/nav/Wayfinding';
import PageSections from '@/components/nav/PageSections';
import Anchor from '@/components/nav/Anchor';
import { dataBaseUrl, getIndex, getStats } from '@/lib/server/data';
import { groundPath, kitFor, shortName } from '@/lib/clubs';
import { groundName } from '@/lib/site';
import { fmtDate, fmtInt, fmtPct } from '@/lib/format';

export const revalidate = 60;
export const metadata: Metadata = {
  title: 'Stock rankings: real holders of every stock token on Base',
  description: 'All 90 Coinbase stock tokens on Base, ranked by how many real holders they have: all holders, real holders, real share, weekly buyers and new buyers.',
};

export default async function AttendancePage() {
  const [{ data: index, source }, { data: stats }] = await Promise.all([getIndex(), getStats()]);
  const tokens = index.tokens;
  const priced = tokens.filter((t) => t.priceUsd != null);
  const held = tokens.reduce((a, t) => a + t.holdersTotal, 0);
  const fans = tokens.reduce((a, t) => a + t.realFans, 0);
  const best = [...priced].filter((t) => t.holdersTotal >= 200).sort((a, b) => b.attendancePct - a.attendancePct)[0];
  const busiest = [...tokens].sort((a, b) => b.weeklyBuyers - a.weeklyBuyers)[0];
  const emptiest = [...priced].filter((t) => t.holdersTotal >= 1000).sort((a, b) => a.attendancePct - b.attendancePct)[0];
  const stack = tokens.slice(0, 10);

  return (
    <>
      <main id="main">
        <PageSections
          sections={[
            { id: 'rankings', label: 'The table' },
            { id: 'highlights', label: 'Three things it shows' },
            { id: 'top-10', label: 'The 10 biggest' },
            { id: 'read', label: 'How to read it' },
            { id: 'limits', label: 'Limits' },
          ]}
        />
        <section className="wrap page-head">
          <Crumbs trail={[{ label: 'Stock rankings' }]} />
          <p className="hero-pitch">Stock rankings</p>
          <h1>Real holders of every stock token</h1>
          <p className="lede">
            All {tokens.length} Coinbase <Term id="stock-token">stock tokens</Term> on Base, ranked by how many wallets really hold them: $10 or more, bought it themselves, and not a contract. Of <span className="num">{fmtInt(held)}</span> token holdings, <span className="num">{fmtInt(fans)}</span> ({fmtPct((fans / Math.max(1, held)) * 100)}) are real. They belong to <span className="num">{fmtInt(stats.realWallets)}</span> wallets.
          </p>
          <p className="asof">Counted {fmtDate(index.asOf, true)}{index.block ? <> <span className="muted small">(Base block {fmtInt(index.block)})</span></> : ''}, and again every 6 hours.</p>
          <p className="muted small">How we decide who is real: the wallet holds $10 or more, it bought the token itself (not only a giveaway), and it is a person&rsquo;s wallet, not a contract. Each token&rsquo;s page is a <Term id="ground">ground</Term>, like the {groundName(tokens[0].name, tokens[0].symbol)}: its holders drawn as a stadium.</p>
          <p className="hero-cta"><a className="btn btn-accent" href="#check">Check my wallet</a></p>
        </section>

        <section className="wrap section-tight" id="rankings" aria-label="Stock rankings">
          <AttendanceTable rows={tokens} />
          <p className="muted small table-note">Buyers in 7 days can be more than holders: some bought and sold again.</p>
        </section>

        <section className="band" id="highlights">
          <div className="wrap">
            <div className="section-head">
              <h2>Three things the table shows<Anchor id="highlights" label="Three things the table shows" /></h2>
            </div>
            <ul className="limits limits-3">
              {best && (
                <li>
                  <h3>Highest real share</h3>
                  <p><Link href={groundPath(best.symbol)}>{shortName(best.name, best.symbol)} ({best.symbol})</Link>: {fmtPct(best.attendancePct)} of holders are real, {fmtInt(best.realFans)} of {fmtInt(best.holdersTotal)}. Small groups of holders can be loyal ones.</p>
                </li>
              )}
              {emptiest && (
                <li>
                  <h3>Lowest real share</h3>
                  <p><Link href={groundPath(emptiest.symbol)}>{shortName(emptiest.name, emptiest.symbol)} ({emptiest.symbol})</Link>: {fmtInt(emptiest.holdersTotal)} holders, {fmtPct(emptiest.attendancePct)} real. Giveaways inflate holder counts.</p>
                </li>
              )}
              {busiest && (
                <li>
                  <h3>Most buyers this week</h3>
                  <p><Link href={groundPath(busiest.symbol)}>{shortName(busiest.name, busiest.symbol)} ({busiest.symbol})</Link> saw {fmtInt(busiest.weeklyBuyers)} wallets buy in the last seven days, {fmtInt(busiest.newBuyers7d)} of them for the first time.</p>
                </li>
              )}
            </ul>
          </div>
        </section>

        <section className="wrap section" id="top-10">
          <div className="section-head">
            <h2>Who holds the 10 biggest tokens<Anchor id="top-10" label="Who holds the 10 biggest tokens" /></h2>
            <p>Each bar is every holder of one token, split by type. Colour shows real holders.</p>
          </div>
          <div className="stacks">
            {stack.map((t) => {
              const kit = kitFor(t.symbol);
              const total = Math.max(1, t.holdersTotal);
              return (
                <Link key={t.symbol} href={groundPath(t.symbol)} className="stack-row" prefetch={false}>
                  <span className="stack-name"><Pennant kit={kit} width={16} />{shortName(t.name, t.symbol)}</span>
                  <span className="stack-bar" role="img" aria-label={`${fmtInt(t.realFans)} real holders, ${fmtInt(t.ghosts.dust)} under $10, ${fmtInt(t.ghosts.farmerOnly)} airdrop-only, ${fmtInt(t.ghosts.contracts)} contracts`}>
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
            <span><i className="sw sw-fan" />Real holders</span>
            <span><i className="sw sw-dust" />Under $10</span>
            <span><i className="sw sw-farmer" />Airdrop-only</span>
            <span><i className="sw sw-contract" />Contracts</span>
          </p>
        </section>

        <section className="band" id="read">
          <div className="wrap split">
            <div className="split-text">
              <h2>How to read it<Anchor id="read" label="How to read it" /></h2>
              <dl className="defs">
                <div><dt>All holders</dt><dd>Every wallet with a balance above zero. The number a block explorer calls &ldquo;holders&rdquo;.</dd></div>
                <div><dt>Real holders (real fans)</dt><dd>Wallets holding $10 or more that belong to a person and did more than receive a giveaway.</dd></div>
                <div><dt>Real share (attendance)</dt><dd>Real holders divided by all holders.</dd></div>
                <div><dt>Buyers, 7 days</dt><dd>Distinct wallets that bought on an exchange (a DEX) in the last week. Bots with more than 50 swaps are left out. Buyers in 7 days can be more than holders: some bought and sold again.</dd></div>
                <div><dt>New buyers, 7 days</dt><dd>Of those, wallets buying that token for the first time.</dd></div>
                <div><dt>Reference price</dt><dd>No active market, so we use the share&rsquo;s last price times the token&rsquo;s split <Term id="multiplier">multiplier</Term>. The $10 line is approximate.</dd></div>
                <div><dt>No price yet</dt><dd>Tokens without a liquid market have no dollar value, so the $10 line cannot be drawn. We count their holders, but can&rsquo;t tell which are real.</dd></div>
              </dl>
              <p><Link href="/about#method">The full method</Link></p>
            </div>
            <div className="split-text" id="feed">
              <h2>For developers: free JSON feed<Anchor id="feed" label="Free JSON feed" /></h2>
              <p>The table is a public file, rewritten at every count, every 6 hours. Use it in a dashboard, a bot or a research note. No key, no sign-up.</p>
              <pre className="code" tabIndex={0}><code>GET {dataBaseUrl}/index.json{'\n'}GET {dataBaseUrl}/tokens/NVDAc.json{'\n'}GET {dataBaseUrl}/stats.json</code></pre>
              <p className="muted small">{source === 'mock' ? 'The first files are published with the indexer’s first run. Until then this page shows sample data.' : `Last written ${fmtDate(index.asOf, true)}.`} Please credit Tropa Club.</p>
              <h3 id="check">Is your wallet a real holder?</h3>
              <SeatSearchBox label="Paste a wallet" button="Check wallet" />
            </div>
          </div>
        </section>

        <section className="wrap section" id="limits">
          <div className="section-head">
            <h2>Limits<Anchor id="limits" label="Limits" /></h2>
          </div>
          <ul className="limits limits-3">
            <li><h3>Counts, not people</h3><p>{fmtInt(stats.realWallets)} distinct wallets make up the {fmtInt(fans)} real holdings. One person can stand behind several of them.</p></li>
            <li><h3>A snapshot</h3><p>Positions move with every count and with the token price. The date above is the only moment this table is true for.</p></li>
            <li><h3>Not a ranking of companies</h3><p>The real share measures holders, not the company or the price. Nothing here is a reason to buy or sell.</p></li>
          </ul>
        </section>

        <NextStrip
          items={[
            { title: `Open the ${groundName(tokens[0].name, tokens[0].symbol)}`, sub: 'The biggest token, every holder drawn as a seat', href: groundPath(tokens[0].symbol) },
            { title: 'Check a wallet', sub: 'Paste any wallet to see its ticket', href: '/#find' },
          ]}
        />
      </main>
    </>
  );
}
