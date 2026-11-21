import type { Metadata } from 'next';
import Link from 'next/link';
import { APPROVALS, ensureStockClubs, tryClubs } from '@/lib/server/clubs';
import { getIndex, getStats } from '@/lib/server/data';
import { fmtDate, fmtInt, fmtUsd, shortAddr } from '@/lib/format';
import { BUILDER_CODE, DOCS_URL, OPENS, PLAY_USD } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Stats: what Tropa Club has measured so far',
  description: 'Unique signers, attributed swaps and approvals, dollars routed, hold rates at D+1, D+3 and D+7, repeat buying and seats. Counted from onchain records, with the exclusion list in the open.',
};

const rate = (n: number | null) => (n == null ? '—' : `${(n * 100).toFixed(0)}%`);

export default async function StatsPage() {
  const [{ data: index }, { data: crowd }, res] = await Promise.all([
    getIndex(),
    getStats(),
    tryClubs(async (svc) => {
      await ensureStockClubs(svc);
      const [s, approvals, clubs] = await Promise.all([svc.getStats(), svc.ctx.store.query<{ txHash: string }>(APPROVALS).catch(() => []), svc.listClubs()]);
      return { s, approvals: approvals.length, clubs };
    }, 25_000),
  ]);
  const lastWeek = crowd.weeklyBuyers[crowd.weeklyBuyers.length - 1];
  const seatsHeld = index.tokens.reduce((a, t) => a + t.realFans, 0);

  if (!res) {
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
  const { s, approvals, clubs } = res;
  const pre = s.attributedTx === 0 && s.submittedTx === 0;
  const totalSeats = s.seats.bench + s.seats.playing;
  const league = clubs.filter((c) => c.kind !== 'stock');
  const stockAll = clubs.filter((c) => c.kind === 'stock');
  const stockWith = stockAll.filter((c) => c.memberCount > 0).length;
  const retention = s.retention.filter((c) => c.eligible > 0);
  const gw0 = s.gw0Retention.filter((c) => c.eligible > 0);

  return (
    <main id="main">
      <section className="wrap page-head">
        <h1>Stats</h1>
        <p className="lede">
          Everything Tropa Club claims about itself, counted from onchain records. Only transactions the member signed are counted, and only those that carry our Builder Code. Wallets that belong to the team are left out and listed below.
        </p>
        <p className="asof">Counted {fmtDate(s.asOf, true)}.</p>
      </section>

      {pre ? (
        <section className="wrap section-tight">
          <div className="season-opens">
            <p className="opens"><span className="tag">Season opens {OPENS}</span></p>
            <h2>No buy has gone through Tropa Club yet</h2>
            <p>
              Buying opens on {OPENS}. From the first buy, this page counts unique signers, swaps and approvals carrying Builder Code <code>{BUILDER_CODE}</code>, dollars routed, and whether buyers are still holding one, three and seven days later. Nothing is shown here until it has been measured.
            </p>
            <p><a href={DOCS_URL} rel="noopener">How each number is counted</a></p>
          </div>
          <h3 className="table-title crowd-title">The crowd today, from the index</h3>
          <dl className="figures">
            <div><dt>Wallets with a real-fan seat</dt><dd className="num">{fmtInt(crowd.realWallets)}</dd><p>{fmtInt(seatsHeld)} seats across {index.tokens.length} clubs.</p></div>
            <div><dt>Buyers last week</dt><dd className="num">{lastWeek ? fmtInt(lastWeek.buyers) : '—'}</dd><p>Wallets that bought any stock token on a DEX.</p></div>
            <div><dt>First-time buyers last week</dt><dd className="num">{lastWeek ? fmtInt(lastWeek.newBuyers) : '—'}</dd><p>The people a club gives a reason to come back.</p></div>
            <div><dt>Clubs founded</dt><dd className="num">{fmtInt(league.length)}</dd><p>{fmtInt(totalSeats)} {totalSeats === 1 ? 'seat' : 'seats'} taken on the Bench so far.</p></div>
          </dl>
          <p className="muted small">These four come from The Attendance and the club list, not from Tropa Club buys. Counted {fmtDate(index.asOf, true)}.</p>
        </section>
      ) : (
        <section className="wrap section-tight" aria-label="Builder Code counter">
          <h2 className="h3 table-title">Builder Code <code>{BUILDER_CODE}</code>, live</h2>
          <dl className="figures">
            <div><dt>Unique signers</dt><dd className="num">{fmtInt(s.uniqueSigners)}</dd><p>Wallets with at least one counted swap.</p></div>
            <div><dt>Swaps</dt><dd className="num">{fmtInt(s.attributedTx)}</dd><p>{s.pctAttributed == null ? 'Carrying the code.' : `${s.pctAttributed.toFixed(0)}% of ${fmtInt(s.submittedTx)} submitted. ${fmtInt(s.attributedVia.tx)} plain, ${fmtInt(s.attributedVia.userop)} smart-wallet.`}</p></div>
            <div><dt>Approvals</dt><dd className="num">{fmtInt(approvals)}</dd><p>Sent as their own transaction by some wallets. Counted apart, never as a swap.</p></div>
            <div><dt>Dollars routed</dt><dd className="num">{fmtUsd(s.usdRouted, 0)}</dd><p>Paid by members to public exchange routes. Tropa Club never held any of it.</p></div>
          </dl>
          <p className="muted small">{fmtInt(s.qualifyingBuys)} swaps count toward lineups and streaks. {fmtInt(s.belowMinBuys)} under ${PLAY_USD} and {fmtInt(s.washBuys)} buy-and-sell-back are left out.</p>
        </section>
      )}

      {!pre && (
        <section className="band">
          <div className="wrap split">
            <div className="split-text">
              <h2>Do buyers keep holding?</h2>
              <p>A buyer counts as still holding if at least half of what they bought through Tropa Club is in the wallet that many days later.</p>
              {retention.length ? (
                <table className="mini-table">
                  <caption className="sr">Hold rate after the first counted buy</caption>
                  <thead><tr><th scope="col">After</th><th scope="col" className="r">Eligible</th><th scope="col" className="r">Still holding</th><th scope="col" className="r">Rate</th></tr></thead>
                  <tbody>
                    {retention.map((c) => (
                      <tr key={c.day}><th scope="row">{c.day} {c.day === 1 ? 'day' : 'days'}</th><td className="r num">{fmtInt(c.eligible)}</td><td className="r num">{fmtInt(c.held)}</td><td className="r num">{rate(c.rate)}</td></tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="notice">The first hold rate appears one day after the first buy.</p>
              )}
              {gw0.length > 0 && (
                <>
                  <h3>Gameweek 0 Playing joiners</h3>
                  <p className="muted small">The cohort named in advance for the D+7 comparison.</p>
                  <table className="mini-table">
                    <caption className="sr">Hold rate for gameweek 0 Playing joiners</caption>
                    <thead><tr><th scope="col">After</th><th scope="col" className="r">Eligible</th><th scope="col" className="r">Still holding</th><th scope="col" className="r">Rate</th></tr></thead>
                    <tbody>
                      {gw0.map((c) => (
                        <tr key={c.day}><th scope="row">{c.day} {c.day === 1 ? 'day' : 'days'}</th><td className="r num">{fmtInt(c.eligible)}</td><td className="r num">{fmtInt(c.held)}</td><td className="r num">{rate(c.rate)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
            <div className="split-text">
              <h2>Do they come back?</h2>
              <p>Of the wallets that bought in one gameweek, how many bought again in the next.</p>
              {s.repeatBuy.some((r) => r.buyers > 0) ? (
                <table className="mini-table">
                  <caption className="sr">Week on week repeat buying</caption>
                  <thead><tr><th scope="col">Weeks</th><th scope="col" className="r">Buyers</th><th scope="col" className="r">Bought again</th><th scope="col" className="r">Rate</th></tr></thead>
                  <tbody>
                    {s.repeatBuy.filter((r) => r.buyers > 0).map((r) => (
                      <tr key={r.gw}><th scope="row">{r.gw} to {r.nextGw}</th><td className="r num">{fmtInt(r.buyers)}</td><td className="r num">{fmtInt(r.repeat)}</td><td className="r num">{rate(r.rate)}</td></tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="notice">The first week-on-week figure appears when gameweek 1 closes on Fri 4 Dec.</p>
              )}
              {(s.twoPlus.buyers > 0 || s.callups > 0) && (
                <dl className="figures figures-2">
                  {s.twoPlus.buyers > 0 && <div><dt>Bought twice or more</dt><dd className="num">{rate(s.twoPlus.share)}</dd><p>{fmtInt(s.twoPlus.twoPlus)} of {fmtInt(s.twoPlus.buyers)} buyers.</p></div>}
                  {s.callups > 0 && <div><dt>Call-ups sent</dt><dd className="num">{fmtInt(s.callups)}</dd><p>Teammates nudged off the Bench.</p></div>}
                </dl>
              )}
            </div>
          </div>
        </section>
      )}

      <section className="wrap section">
        <div className="split">
          <div className="split-text">
            <h2>Bench and Playing</h2>
            <p>A Bench seat is free and needs no buy. It is reported apart from Playing seats so the member count cannot flatter the buying.</p>
            {totalSeats > 0 ? (
              <>
                <div className="gate-bar" role="img" aria-label={`${fmtInt(s.seats.playing)} Playing seats and ${fmtInt(s.seats.bench)} Bench seats`}>
                  <span className="gate-seg seat-playing" style={{ flexGrow: Math.max(s.seats.playing, 0.001) }} />
                  <span className="gate-seg gate-dust" style={{ flexGrow: Math.max(s.seats.bench, 0.001) }} />
                </div>
                <dl className="figures figures-2">
                  <div><dt>Playing seats</dt><dd className="num">{fmtInt(s.seats.playing)}</dd><p>{fmtInt(s.seats.walletsPlaying)} wallets. {((s.seats.playing / totalSeats) * 100).toFixed(0)}% of seats.</p></div>
                  <div><dt>Bench seats</dt><dd className="num">{fmtInt(s.seats.bench)}</dd><p>{fmtInt(s.seats.walletsBench)} wallets yet to buy.</p></div>
                  <div><dt>Clubs in the league</dt><dd className="num">{fmtInt(league.length)}</dd><p>{fmtInt(s.clubs.private)} private, {fmtInt(s.clubs.pickup)} pick-up.</p></div>
                  <div><dt>Stock clubs with supporters</dt><dd className="num">{fmtInt(stockWith)}</dd><p>Of {fmtInt(stockAll.length)}, one for every stock.</p></div>
                </dl>
              </>
            ) : (
              <p className="notice">No seat has been taken yet. The first club founded puts the first seat on the Bench. <Link href="/clubs#start">Found a club</Link></p>
            )}
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
              <li>Some wallets send the approval and the swap as two transactions. Both carry the code. They are counted in separate columns, so an approval never inflates the swap count.</li>
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
          <p>Every seat and every buy on this page comes from a club or a fan.</p>
          <p className="closing-links"><Link className="btn btn-accent" href="/clubs">Clubs</Link><Link href="/league">The league</Link></p>
        </div>
      </section>
    </main>
  );
}
