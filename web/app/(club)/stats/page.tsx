import type { Metadata } from 'next';
import Link from 'next/link';
import { tryClubs } from '@/lib/server/clubs';
import { fmtDate, fmtInt, fmtUsd, shortAddr } from '@/lib/format';
import { BUILDER_CODE, DOCS_URL } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Stats: what Tropa Club has measured so far',
  description: 'Unique signers, attributed transactions, dollars routed, hold rates at D+1, D+3 and D+7, repeat buying and seats. Counted from onchain records, with the exclusion list in the open.',
};

const rate = (n: number | null) => (n == null ? '—' : `${(n * 100).toFixed(0)}%`);

export default async function StatsPage() {
  const s = await tryClubs((svc) => svc.getStats(), 25_000);
  if (!s) {
    return (
      <main id="main">
        <section className="wrap page-head empty">
          <h1>Stats</h1>
          <p className="lede">The numbers could not be counted just now. Try again in a minute.</p>
          <p className="closing-links"><Link className="btn" href="/stats">Try again</Link></p>
        </section>
      </main>
    );
  }
  const totalSeats = s.seats.bench + s.seats.playing;
  return (
    <main id="main">
      <section className="wrap page-head">
        <h1>Stats</h1>
        <p className="lede">
          Everything Tropa Club claims about itself, counted from onchain records. Only transactions the member signed are counted, and only those that carry our Builder Code. Wallets that belong to the team are left out and listed below.
        </p>
        <p className="asof">Counted {fmtDate(s.asOf, true)}. Past performance · not advice.</p>
      </section>

      <section className="wrap section-tight">
        <dl className="figures">
          <div><dt>Unique signers</dt><dd className="num">{fmtInt(s.uniqueSigners)}</dd><p>Wallets with at least one counted buy.</p></div>
          <div><dt>Attributed transactions</dt><dd className="num">{fmtInt(s.attributedTx)}</dd><p>{s.pctAttributed == null ? 'No buys submitted yet.' : `${s.pctAttributed.toFixed(0)}% of ${fmtInt(s.submittedTx)} submitted. ${fmtInt(s.attributedVia.tx)} plain, ${fmtInt(s.attributedVia.userop)} smart-wallet.`}</p></div>
          <div><dt>Dollars routed</dt><dd className="num">{fmtUsd(s.usdRouted, 0)}</dd><p>Paid by members to public exchange routes. Tropa Club never held any of it.</p></div>
          <div><dt>Qualifying buys</dt><dd className="num">{fmtInt(s.qualifyingBuys)}</dd><p>{fmtInt(s.belowMinBuys)} under $10 and {fmtInt(s.washBuys)} buy-and-sell-back left out.</p></div>
        </dl>
      </section>

      <section className="band">
        <div className="wrap split">
          <div className="split-text">
            <h2>Do buyers keep holding?</h2>
            <p>A buyer counts as still holding if at least half of what they bought through Tropa Club is in the wallet that many days later. A cell stays empty until its day has passed.</p>
            <table className="mini-table">
              <caption className="sr">Hold rate after the first counted buy</caption>
              <thead><tr><th scope="col">After</th><th scope="col" className="r">Eligible</th><th scope="col" className="r">Still holding</th><th scope="col" className="r">Rate</th></tr></thead>
              <tbody>
                {s.retention.map((c) => (
                  <tr key={c.day}><th scope="row">{c.day} {c.day === 1 ? 'day' : 'days'}</th><td className="r num">{fmtInt(c.eligible)}</td><td className="r num">{fmtInt(c.held)}</td><td className="r num">{rate(c.rate)}</td></tr>
                ))}
              </tbody>
            </table>
            <h3>Gameweek 0 Playing joiners</h3>
            <p className="muted small">The cohort named in advance for the D+7 comparison.</p>
            <table className="mini-table">
              <caption className="sr">Hold rate for gameweek 0 Playing joiners</caption>
              <thead><tr><th scope="col">After</th><th scope="col" className="r">Eligible</th><th scope="col" className="r">Still holding</th><th scope="col" className="r">Rate</th></tr></thead>
              <tbody>
                {s.gw0Retention.map((c) => (
                  <tr key={c.day}><th scope="row">{c.day} {c.day === 1 ? 'day' : 'days'}</th><td className="r num">{fmtInt(c.eligible)}</td><td className="r num">{fmtInt(c.held)}</td><td className="r num">{rate(c.rate)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="split-text">
            <h2>Do they come back?</h2>
            <p>Of the wallets that bought in one gameweek, how many bought again in the next.</p>
            {s.repeatBuy.length ? (
              <table className="mini-table">
                <caption className="sr">Week on week repeat buying</caption>
                <thead><tr><th scope="col">Weeks</th><th scope="col" className="r">Buyers</th><th scope="col" className="r">Bought again</th><th scope="col" className="r">Rate</th></tr></thead>
                <tbody>
                  {s.repeatBuy.map((r) => (
                    <tr key={r.gw}><th scope="row">{r.gw} to {r.nextGw}</th><td className="r num">{fmtInt(r.buyers)}</td><td className="r num">{fmtInt(r.repeat)}</td><td className="r num">{rate(r.rate)}</td></tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="notice">The first week-on-week figure appears when gameweek 1 closes on Fri 4 Dec.</p>
            )}
            <dl className="figures figures-2">
              <div><dt>Bought twice or more</dt><dd className="num">{rate(s.twoPlus.share)}</dd><p>{fmtInt(s.twoPlus.twoPlus)} of {fmtInt(s.twoPlus.buyers)} buyers.</p></div>
              <div><dt>Call-ups sent</dt><dd className="num">{fmtInt(s.callups)}</dd><p>Teammates nudged off the Bench.</p></div>
            </dl>
          </div>
        </div>
      </section>

      <section className="wrap section">
        <div className="split">
          <div className="split-text">
            <h2>Bench and Playing</h2>
            <p>A Bench seat is free and needs no buy. It is reported apart from Playing seats so the member count cannot flatter the buying.</p>
            <div className="gate-bar" role="img" aria-label={`${fmtInt(s.seats.playing)} Playing seats and ${fmtInt(s.seats.bench)} Bench seats`}>
              <span className="gate-seg seat-playing" style={{ flexGrow: Math.max(s.seats.playing, 0.001) }} />
              <span className="gate-seg gate-dust" style={{ flexGrow: Math.max(s.seats.bench, 0.001) }} />
            </div>
            <dl className="figures figures-2">
              <div><dt>Playing seats</dt><dd className="num">{fmtInt(s.seats.playing)}</dd><p>{fmtInt(s.seats.walletsPlaying)} wallets. {totalSeats ? `${((s.seats.playing / totalSeats) * 100).toFixed(0)}% of seats.` : ''}</p></div>
              <div><dt>Bench seats</dt><dd className="num">{fmtInt(s.seats.bench)}</dd><p>{fmtInt(s.seats.walletsBench)} wallets yet to buy.</p></div>
              <div><dt>Clubs in the league</dt><dd className="num">{fmtInt(s.clubs.private + s.clubs.pickup)}</dd><p>{fmtInt(s.clubs.private)} private, {fmtInt(s.clubs.pickup)} pick-up. {fmtInt(s.clubs.playingClubs)} with someone playing.</p></div>
              <div><dt>Stock clubs</dt><dd className="num">{fmtInt(s.clubs.stock)}</dd><p>In the Supporters table.</p></div>
            </dl>
          </div>
          <div className="split-text">
            <h2>Against a control group</h2>
            <div className="chart-wait" role="img" aria-label="Cohort chart placeholder: the comparison is published on 3 Dec">
              <span /><span /><span /><span />
              <p>The chart is drawn on Thu 3 Dec, once the first joiners reach seven days.</p>
            </div>
            <p>Club joiners will be compared with ordinary first-time buyers of the same token, the same week and a similar size, and with cashback-campaign recipients. The method was fixed before any data existed.</p>
            <p className="muted small">Descriptive, not causal: joiners choose to join. <a href={DOCS_URL} rel="noopener">Read the method in the docs</a></p>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="wrap split">
          <div className="split-text">
            <h2>How buys are counted</h2>
            <ul className="ticks">
              <li>Each buy carries Builder Code <code>{BUILDER_CODE}</code> at the end of the transaction, the way Base attributes activity to an app.</li>
              <li>After a buy confirms, the server reads the transaction itself and checks the code. A buy without it is not counted.</li>
              <li>A sweep catches buys the browser never reported.</li>
              <li>Approvals and buys are separate transactions for some wallets. Only the buy is counted.</li>
            </ul>
          </div>
          <div className="split-text">
            <h2>Wallets left out</h2>
            {s.exclusions.length ? (
              <ul className="ghost-list">
                {s.exclusions.map((e) => (
                  <li key={e.wallet}><span className="num">{shortAddr(e.wallet)}</span><span>{e.label}: {e.reason}</span></li>
                ))}
              </ul>
            ) : (
              <p className="notice">No wallet is excluded yet. Founder and test wallets are added here before they are used, so they never reach a count.</p>
            )}
          </div>
        </div>
      </section>

      <section className="closing">
        <div className="wrap closing-in">
          <h2>Add to the count</h2>
          <p>Every seat and every buy on this page came from a club.</p>
          <p className="closing-links"><Link className="btn btn-accent" href="/clubs">Clubs</Link><Link href="/league">The league</Link></p>
        </div>
      </section>
    </main>
  );
}
