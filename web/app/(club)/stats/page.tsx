import type { Metadata } from 'next';
import Link from 'next/link';
import { APPROVALS, ensureStockClubs, tryClubs } from '@/lib/server/clubs';
import { getIndex, getStats } from '@/lib/server/data';
import { fmtDate, fmtInt, fmtUsd, shortAddr } from '@/lib/format';
import { BUILDER_CODE, DOCS_URL, PLAY_USD, buyState } from '@/lib/site';
import BuyWhen from '@/components/buy/BuyWhen';
import Term from '@/components/nav/Term';
import { Crumbs, NextStrip } from '@/components/nav/Wayfinding';

export const metadata: Metadata = {
  title: 'Stats: Tropa Club’s own numbers',
  description: 'How many people have bought through Tropa Club and kept holding, counted from public Base records: buyers, buys and approvals, dollars, hold rates after 1, 3 and 7 days, repeat buying and club members. Team wallets are left out.',
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
          <Crumbs trail={[{ label: 'Stats' }]} />
          <h1>Tropa Club&rsquo;s own numbers</h1>
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
        <Crumbs trail={[{ label: 'Stats' }]} />
        <h1>Tropa Club&rsquo;s own numbers</h1>
        <p className="lede">
          How many people have bought through Tropa Club and kept holding, counted from public Base records. Only transactions the member signed are counted, and only buys tagged with our <Term id="builder-code">Builder Code</Term> (a label Base uses to credit an app). Team wallets are left out and listed below.
        </p>
        <p className="hero-cta"><a className="btn" href="#how">See how we count</a></p>
        <p className="asof">Club numbers are live. Stock token holders were counted {fmtDate(index.asOf, true)}.</p>
      </section>

      {pre ? (
        <section className="wrap section-tight">
          <div className="season-opens">
            <p className="opens"><BuyWhen state={buyState()} /></p>
            <h2>No buy has gone through Tropa Club yet</h2>
            <p>
              From the first buy, this page counts how many people bought, how many buys and approvals carry Builder Code <code>{BUILDER_CODE}</code>, total dollars, and how many buyers still hold after 1, 3 and 7 days. Nothing is shown here until it has been measured.
            </p>
            <p><a href={DOCS_URL} rel="noopener">How each number is counted</a></p>
          </div>
          <h3 className="table-title crowd-title">Stock token holders today (not Tropa Club buys)</h3>
          <dl className="figures">
            <div><dt>Wallets that are real holders</dt><dd className="num">{fmtInt(crowd.realWallets)}</dd><p>{fmtInt(seatsHeld)} real holdings across {index.tokens.length} tokens.</p></div>
            <div><dt>Buyers last week</dt><dd className="num">{lastWeek ? fmtInt(lastWeek.buyers) : '—'}</dd><p>Wallets that bought any stock token on an exchange.</p></div>
            <div><dt>First-time buyers last week</dt><dd className="num">{lastWeek ? fmtInt(lastWeek.newBuyers) : '—'}</dd><p>Wallets buying a stock token for the first time.</p></div>
            <div><dt>Clubs started</dt><dd className="num">{fmtInt(league.length)}</dd><p>{fmtInt(totalSeats)} {totalSeats === 1 ? 'person has' : 'people have'} joined a club so far.</p></div>
          </dl>
          <p className="muted small">These four come from the stock rankings and the club list, not from Tropa Club buys.</p>
        </section>
      ) : (
        <section className="wrap section-tight" aria-label="Builder Code counter">
          <h2 className="h3 table-title">Buys tagged with Builder Code <code>{BUILDER_CODE}</code>, live</h2>
          <dl className="figures">
            <div><dt>People who bought</dt><dd className="num">{fmtInt(s.uniqueSigners)}</dd><p>Wallets with at least one counted buy.</p></div>
            <div><dt>Buys</dt><dd className="num">{fmtInt(s.attributedTx)}</dd><p>{s.pctAttributed == null ? 'Carrying the code.' : `${s.pctAttributed.toFixed(0)}% of ${fmtInt(s.submittedTx)} submitted. ${fmtInt(s.attributedVia.tx)} plain, ${fmtInt(s.attributedVia.userop)} smart-wallet.`}</p></div>
            <div><dt>Approvals</dt><dd className="num">{fmtInt(approvals)}</dd><p>Sent as their own transaction by some wallets. Counted apart, never as a buy.</p></div>
            <div><dt>Total dollars</dt><dd className="num">{fmtUsd(s.usdRouted, 0)}</dd><p>Paid by members to public exchanges from their own wallets. Tropa Club never held any of it.</p></div>
          </dl>
          <p className="muted small">{fmtInt(s.qualifyingBuys)} buys count as played and toward streaks. {fmtInt(s.belowMinBuys)} under ${PLAY_USD} and {fmtInt(s.washBuys)} buy-and-sell-back are left out.</p>
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
                  <h3>Club members who bought in week 0</h3>
                  <p className="muted small">The group named in advance for the day-7 comparison.</p>
                  <table className="mini-table">
                    <caption className="sr">Hold rate for club members who bought in week 0</caption>
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
                  {s.callups > 0 && <div><dt>Nudges sent</dt><dd className="num">{fmtInt(s.callups)}</dd><p>Messages to teammates who hadn&rsquo;t bought yet.</p></div>}
                </dl>
              )}
            </div>
          </div>
        </section>
      )}

      <section className="wrap section">
        <div className="split">
          <div className="split-text">
            <h2>Members and buyers</h2>
            <p>Joining a club is free, so we report members and buyers separately. Joins can&rsquo;t make the buying look bigger.</p>
            {totalSeats > 0 ? (
              <>
                <div className="gate-bar" role="img" aria-label={`${fmtInt(s.seats.playing)} memberships that bought this week and ${fmtInt(s.seats.bench)} that have not`}>
                  <span className="gate-seg seat-playing" style={{ flexGrow: Math.max(s.seats.playing, 0.001) }} />
                  <span className="gate-seg gate-dust" style={{ flexGrow: Math.max(s.seats.bench, 0.001) }} />
                </div>
                <dl className="figures figures-2">
                  <div><dt>Bought this week</dt><dd className="num">{fmtInt(s.seats.playing)}</dd><p>{fmtInt(s.seats.walletsPlaying)} wallets. {((s.seats.playing / totalSeats) * 100).toFixed(0)}% of memberships.</p></div>
                  <div><dt>On the Bench (not bought yet)</dt><dd className="num">{fmtInt(s.seats.bench)}</dd><p>{fmtInt(s.seats.walletsBench)} wallets yet to buy.</p></div>
                  <div><dt>Friend clubs</dt><dd className="num">{fmtInt(league.length)}</dd><p>{fmtInt(s.clubs.private)} private, {fmtInt(s.clubs.pickup)} pick-up.</p></div>
                  <div><dt>Open clubs with members</dt><dd className="num">{fmtInt(stockWith)}</dd><p>Of {fmtInt(stockAll.length)}, one for every stock token.</p></div>
                </dl>
              </>
            ) : (
              <p className="notice">0 people have joined a club so far. <Link href="/clubs#start">Start a club</Link></p>
            )}
          </div>
          <div className="split-text">
            <h2>Do clubs help people keep holding?</h2>
            <p><strong>Published Thu Dec 3</strong>, once the first members reach day 7.</p>
            <p>We&rsquo;ll compare club members with similar first-time buyers of the same token in the same week who didn&rsquo;t join. A second comparison group is first-time buyers that week who were paid a trading reward (cashback) by another app, found from their public claims on the Merkl reward contract. The method was fixed before any data existed.</p>
            <p className="muted small">This shows a pattern, not proof: people choose to join. <a href={`${DOCS_URL}/retention-evidence`} rel="noopener">Read the method in the docs</a></p>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="wrap split">
          <div className="split-text">
            <h2 id="how">How buys are counted</h2>
            <ul className="ticks">
              <li>Each buy carries Builder Code <code>{BUILDER_CODE}</code> at the end of the transaction, the way Base attributes activity to an app.</li>
              <li>After a buy confirms, the server reads the transaction itself and checks the code. A buy without it is not counted.</li>
              <li>A regular check also finds buys the website missed.</li>
              <li>Some wallets send the approval and the swap as two transactions. Both carry the code. They are counted in separate columns, so an approval never inflates the buy count.</li>
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
          <p>Every member and every buy on this page comes from someone who chose to join or buy.</p>
          <p className="closing-links"><Link className="btn btn-accent" href="/clubs#start">Start a club</Link><Link href="/league">Club rankings</Link></p>
        </div>
      </section>

      <NextStrip
        items={[
          { title: 'Stock rankings', sub: 'Real holders of every stock token, ranked', href: '/attendance' },
          { title: 'Club rankings', sub: 'Club scores, open clubs, Caps (season points) and Scouts', href: '/league' },
        ]}
      />
    </main>
  );
}
