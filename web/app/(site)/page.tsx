import type { Metadata } from 'next';
import Link from 'next/link';
import type { WalletTokenEntry } from '@shared/types';
import GroundStage from '@/components/GroundStage';
import GateReport from '@/components/GateReport';
import Ticket from '@/components/ds/Ticket';
import AttendanceTable from '@/components/AttendanceTable';
import WeeklyChart from '@/components/WeeklyChart';
import SeatSearchBox from '@/components/SeatSearchBox';
import ClubPreview from '@/components/ClubPreview';
import OpensAt from '@/components/OpensAt';
import BuyWhen from '@/components/buy/BuyWhen';
import { Pennant } from '@/components/ds/Pennant';
import Term from '@/components/nav/Term';
import { getExamples, getIndex, getStats } from '@/lib/server/data';
import { groundPath, kitFor, shortName } from '@/lib/clubs';
import { fmtDate, fmtInt, fmtPct, fmtUsd } from '@/lib/format';
import { LAUNCH_AT, PAUSED_MESSAGE, PAY_WITH, PLAY_USD, REGION_LINE, TAGLINE, TWO_THINGS, buyState, groundName } from '@/lib/site';

export const revalidate = 300;
export const metadata: Metadata = {
  title: { absolute: 'Tropa Club: who really holds each stock token' },
  description: TAGLINE,
};

const SPECIMEN = '0x7a3f9c2e41b85d06e9a1c4f27b3d8e5a60c9f1d4';

export default async function Home() {
  const [{ data: index }, { data: stats }, examples] = await Promise.all([getIndex(), getStats(), getExamples()]);
  const tokens = index.tokens;
  const top = tokens[0];
  const topName = shortName(top.name, top.symbol);
  const topGround = groundName(top.name, top.symbol);
  const tabs = tokens.filter((t) => t.realFans > 0).slice(0, 7).map((t) => t.symbol);
  const clubs = tokens.map(({ symbol, name, holdersTotal, realFans, ghosts, attendancePct }) => ({ symbol, name, holdersTotal, realFans, ghosts, attendancePct }));
  // The specimen's rank and its line agree: rank goes by time held, so rank 131 of 1,617 has held longer than 92%.
  const specimenRank = Math.max(1, Math.round(top.realFans * 0.081));
  const specimen: WalletTokenEntry = { symbol: top.symbol, usd: 0, kind: 'real', rank: specimenRank, of: top.realFans, bestStat: { key: 'longestHold', label: 'Longest hold', pct: Math.max(1, Math.round((specimenRank / Math.max(1, top.realFans)) * 100)) } };
  const seats = tokens.reduce((a, t) => a + t.realFans, 0);
  const sumHeld = tokens.reduce((a, t) => a + t.holdersTotal, 0);
  const lastWeek = stats.weeklyBuyers[stats.weeklyBuyers.length - 1];
  const median = lastWeek && lastWeek.medianBuyUsd > 0 ? lastWeek.medianBuyUsd : null;
  const top10 = tokens.slice(0, 7).map((t) => t.top10SharePct).filter((n) => isFinite(n));
  const rail = tokens.filter((t) => t.realFans > 0).slice(0, 12);
  const state = buyState();

  return (
    <>
      <main id="main">
        <section className="hero wrap" aria-label="What Tropa Club is">
          <GroundStage
            mode="hero"
            clubs={clubs}
            tabs={tabs}
            initial={top.symbol}
            examples={examples}
            pitch="Free. For Coinbase’s stock tokens on Base."
            lede={<>Tropa Club shows who really holds each stock token, and helps your group chat each buy about $10 a week from your own wallets.</>}
            note={<>Nothing to connect or sign. No fee. We never hold your money. A <Term id="stock-token">stock token</Term> tracks a share price, like {topName}&rsquo;s. It is not the share.</>}
          />
        </section>

        <section className="wrap section" id="what" aria-labelledby="what-h">
          <div className="section-head">
            <h2 id="what-h">What Tropa Club does</h2>
            <p>Two things. You can use the first without the second.</p>
          </div>
          <div className="split">
            <div className="split-text">
              <h3>1. {TWO_THINGS[0].title}</h3>
              <p>
                Across all {tokens.length} stock tokens on Base, <strong className="num">{fmtInt(stats.realWallets)}</strong> wallets are <Term id="real-fan">real holders</Term>. A block explorer counts every wallet with a balance above zero; we count the ones that hold $10 or more, bought it themselves, and belong to a person, not a contract.
              </p>
              <p className="closing-links"><a className="btn btn-accent" href="#hero-find">Check my wallet</a><Link href="/attendance">See all {tokens.length} stock tokens</Link></p>
            </div>
            <div className="split-text">
              <h3>2. {TWO_THINGS[1].title}</h3>
              <p>{TWO_THINGS[1].text}</p>
              <p className="muted small clubs-only">{state === 'before' && Date.now() < Date.parse(LAUNCH_AT) ? <>Buying opens <OpensAt at={LAUNCH_AT} />. </> : state === 'paused' ? `${PAUSED_MESSAGE} ` : ''}{REGION_LINE}</p>
              <p className="closing-links"><Link className="btn" href="/clubs#start">Start a club with friends</Link><Link href="/clubs">How clubs work</Link></p>
            </div>
          </div>
        </section>

        <section className="band" id="truth">
          <div className="wrap split">
            <div className="split-text">
              <h2>Who really holds {topName}&rsquo;s stock token</h2>
              <p>
                We draw each token as a stadium, a <Term id="ground">ground</Term>. Every holder is a seat. Lit seats are real holders: {fmtInt(top.realFans)} wallets hold at least $10 of {top.symbol}, bought it themselves, and are a person&rsquo;s wallet, not a contract. Separately, {fmtInt(top.newBuyers7d)} wallets bought {top.symbol} for the first time in the last week, and some of them are already in that count.
              </p>
              <p>
                A block explorer like Basescan counts every wallet with a balance above zero: {fmtInt(top.holdersTotal)} for {top.symbol}. Most of the difference is leftovers worth cents, giveaway recipients and contracts. Counting the real holders apart gives a real share (<Term id="attendance">attendance</Term>) of <strong className="num">{fmtPct(top.attendancePct)}</strong>, a number that only grows when real people buy and hold.
              </p>
              <p><Link className="tap" href="/about#method">How each type is told apart</Link></p>
            </div>
            <GateReport token={top} />
          </div>
        </section>

        <section className="wrap section" id="find">
          <div className="split split-ticket">
            <div className="split-text">
              <h2>Every real holder gets a shareable ticket</h2>
              <p>
                Paste any wallet to see its rank. If it is a real holder, it gets a <Term id="ticket">ticket</Term> for each token it really holds: its seat in that ground, its rank and its best stat, like how long it has held. It is a picture to share, not an NFT.
              </p>
              <ul className="ticks">
                <li>Ranked by time held, then by who bought first. Never by how much you hold.</li>
                <li>The barcode is cut from the bytes of your address. No two are alike.</li>
                <li>The ticket itself shows no dollar amounts. Like any wallet, its history is public on Base.</li>
              </ul>
              <SeatSearchBox label="Paste a wallet to see its ticket" button="Show ticket" note="Read-only. Nothing to connect or sign." />
            </div>
            <div className="ticket-stage">
              <Ticket address={SPECIMEN} entry={specimen} token={top} asOf={index.asOf} specimen headingLevel={3} />
              <p className="caption">A sample for the {topGround}. Real tickets show the wallet&rsquo;s own rank.</p>
            </div>
          </div>
        </section>

        <section className="band clubs-only" id="clubs">
          <div className="wrap">
            <div className="section-head">
              <h2>Part two: clubs for your group chat</h2>
              <p>
                A <Term id="club">club</Term> is you and your friends each buying about $10 of stock tokens a week, from your own wallets. Tropa Club shows who bought each week, keeps your streaks and keeps a cost-basis record. Starting a club is free and needs no buy.
              </p>
              <p><strong>No shared pot. No fee. We never hold your money.</strong></p>
              <p className="opens"><BuyWhen state={state} />{state === 'paused' ? ' ' : '. '}{REGION_LINE}</p>
            </div>
            <ol className="steps">
              <li>
                <div className="step-art" aria-hidden="true">
                  <span className="rail">
                    {['NVDAc', 'TSLAc', 'SPCXc', 'GOOGLc'].map((s, i) => (
                      <span key={s} style={{ '--drop': `${[0, 14, 4, 20][i]}px` } as React.CSSProperties}><Pennant kit={kitFor(s)} width={26} /></span>
                    ))}
                  </span>
                </div>
                <h3>1. Start a club</h3>
                <p>Name it and send the invite link to your group chat. No group chat? Get matched into a <Term id="pickup-club">pick-up club</Term> of up to five. Each club gets its own crest.</p>
              </li>
              <li>
                <div className="step-art" aria-hidden="true"><span className="tenner"><b>$10</b><small>a week</small></span></div>
                <h3>2. Each buys about $10 a week</h3>
                <p>Everyone buys from their own wallet, paid in {PAY_WITH}. ${PLAY_USD} or more through Tropa Club in a week counts. Tropa Club never holds the money and takes no fee.</p>
              </li>
              <li>
                <div className="step-art" aria-hidden="true">
                  <span className="board"><b>4</b><small>Played</small><b>1</b><small>Bench</small></span>
                </div>
                <h3>3. See who bought this week</h3>
                <p>Each <Term id="gameweek">gameweek</Term>, your club&rsquo;s <Term id="matchday">Matchday card</Term> shows who bought (played) and who hasn&rsquo;t yet (the <Term id="bench">Bench</Term>), plus streaks and turnout. No prize depends on returns.</p>
              </li>
              <li>
                <div className="step-art" aria-hidden="true">
                  <span className="bench"><i /><i /><i /><i /><i className="called" /></span>
                </div>
                <h3>4. Nudge a friend</h3>
                <p>One tap opens WhatsApp or Telegram with a message for a friend who hasn&rsquo;t bought yet this week. You send it yourself.</p>
              </li>
            </ol>
            <div className="preview-head">
              <h3>A sample weekly card</h3>
              <p>Four of five have bought this week (played). One is on the Bench: not bought yet. Try the nudge.</p>
            </div>
            <ClubPreview />
            <p className="after-table club-cta">
              <Link className="btn btn-accent" href="/clubs#start">Start a club</Link>
              <Link className="btn" href="/clubs#join">Join with an invite</Link>
              <Link className="btn" href="/league">See club rankings</Link>
            </p>
            <p className="muted small"><Link href="/league?tab=caps">Earn points (we call them Caps) by playing each week and bringing friends.</Link></p>
            <p className="muted small">Checking wallets and holder counts works everywhere, including the US.</p>
          </div>
        </section>

        <section className="wrap section" id="attendance">
          <div className="section-head">
            <h2>Real holders of all {tokens.length} stock tokens</h2>
            <p>
              Every Coinbase stock token on Base, ranked by how many real holders it has, counted again every 6 hours. Here is the top of the list.
            </p>
          </div>
          <AttendanceTable rows={tokens.slice(0, 7)} controls={false} />
          <p className="after-table"><Link className="btn" href="/attendance">See all {tokens.length} stock tokens</Link></p>
        </section>

        <section className="band" id="evidence">
          <div className="wrap">
            <div className="section-head">
              <h2>What the count found</h2>
              <p>Every transfer of every stock token since the first mint on 12 Aug 2026, replayed into balances and checked against supply.</p>
            </div>
            <dl className="figures">
              <div>
                <dt>Wallets holding any stock token</dt>
                <dd className="num">{fmtInt(stats.holdersTotal)}</dd>
                <p>{fmtInt(sumHeld)} holdings across {tokens.length} tokens, since many wallets hold more than one.</p>
              </div>
              <div>
                <dt>Wallets that are real holders</dt>
                <dd className="num">{fmtInt(stats.realWallets)}</dd>
                <p>{fmtInt(seats)} real holdings across those wallets, since a wallet can be a real holder of several tokens. {fmtInt(stats.realWallets100)} hold $100 or more.</p>
              </div>
              <div>
                <dt>Median weekly buy, all tokens</dt>
                <dd className="num">{median != null ? fmtUsd(median, median < 100 ? 2 : 0) : '—'}</dd>
                <p>{median != null ? <>The middle buyer&rsquo;s total for the week of {fmtDate(lastWeek!.weekStart)}, bots removed. {median <= 25 ? 'Small and regular is the norm, which is where “about $10 a week” comes from.' : 'Half of all buyers spent less than this.'}</> : 'Published with the next count.'}</p>
              </div>
              <div>
                <dt>Share held by the top 10 wallets</dt>
                <dd className="num">{top10.length ? `${Math.min(...top10).toFixed(0)}% to ${Math.max(...top10).toFixed(0)}%` : '—'}</dd>
                <p>In the biggest tokens, the top 10 wallets hold this much. So nothing here is ranked by size: a $10 holder and a $1 million holder are ranked the same way.</p>
              </div>
            </dl>
            <div className="split split-chart">
              <div className="split-text">
                <h3>New buyers keep arriving</h3>
                <p>
                  {lastWeek ? <>In the week of {fmtDate(lastWeek.weekStart)}, {fmtInt(lastWeek.buyers)} wallets bought a stock token on an exchange, and {fmtInt(lastWeek.newBuyers)} of them had never bought one before.</> : 'Weekly buyer counts will appear here.'}{' '}
                  A club is a reason to come back the week after.
                </p>
              </div>
              <WeeklyChart weeks={stats.weeklyBuyers} />
            </div>
          </div>
        </section>

        <section className="wrap section" id="limits">
          <div className="section-head">
            <h2>What this does not tell you</h2>
          </div>
          <ul className="limits">
            <li><h3>A token is not a share</h3><p>Stock tokens track the share price. Holding one gives economic exposure, not ownership of the share and not a vote.</p></li>
            <li><h3>A wallet is not a person</h3><p>One person can hold several wallets. &ldquo;Real holder&rdquo; means a wallet that passes the tests, nothing more.</p></li>
            <li><h3>The $10 line moves with price</h3><p>Dollar values use the exchange price at the time of the count. A wallet near the line can become, or stop being, a real holder between counts.</p></li>
            <li><h3>Airdrop-only is a judgement</h3><p>Giveaway contracts are labelled by how they behave. The labels and the excluded wallets are published so anyone can check them.</p></li>
            <li><h3>Nothing here is advice</h3><p>The real share describes who holds a token today. It says nothing about what the price will do.</p></li>
            <li><h3>Ranks can change</h3><p>The drawing is redone at every count. A ticket is a record of one count, with its date on it.</p></li>
          </ul>
        </section>

        <section className="closing">
          <div className="wrap">
            <div className="rail rail-wide" aria-hidden="true">
              {rail.map((t, i) => (
                <span key={t.symbol} style={{ '--drop': `${[0, 22, 8, 30, 12, 0, 26, 6, 18, 2, 24, 10][i % 12]}px` } as React.CSSProperties}><Pennant kit={kitFor(t.symbol)} width={34} /></span>
              ))}
            </div>
            <div className="closing-in">
              <h2>Is your wallet a real holder?</h2>
              <p>{fmtInt(stats.realWallets)} wallets are real holders of at least one stock token. Paste yours and see where it ranks.</p>
              <SeatSearchBox label="Wallet address or name" button="Check wallet" />
              <p className="closing-links">
                <Link href="/attendance">Stock rankings</Link>
                <Link href={groundPath(top.symbol)}>Open the {topGround}</Link>
                <Link href="/about">How it works</Link>
              </p>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
