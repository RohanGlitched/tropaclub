import Link from 'next/link';
import type { WalletTokenEntry } from '@shared/types';
import GroundStage from '@/components/GroundStage';
import GateReport from '@/components/GateReport';
import Ticket from '@/components/ds/Ticket';
import AttendanceTable from '@/components/AttendanceTable';
import WeeklyChart from '@/components/WeeklyChart';
import SeatSearchBox from '@/components/SeatSearchBox';
import ClubPreview from '@/components/ClubPreview';
import { Pennant } from '@/components/ds/Pennant';
import { getExamples, getIndex, getStats } from '@/lib/server/data';
import { clubName, groundPath, kitFor } from '@/lib/clubs';
import { fmtDate, fmtInt, fmtPct, fmtUsd } from '@/lib/format';
import { OPENS, PAY_WITH, RULE_LINE, TAGLINE } from '@/lib/site';

export const revalidate = 300;

const SPECIMEN = '0x7a3f9c2e41b85d06e9a1c4f27b3d8e5a60c9f1d4';

export default async function Home() {
  const [{ data: index }, { data: stats }, examples] = await Promise.all([getIndex(), getStats(), getExamples()]);
  const tokens = index.tokens;
  const top = tokens[0];
  const tabs = tokens.filter((t) => t.realFans > 0).slice(0, 7).map((t) => t.symbol);
  const clubs = tokens.map(({ symbol, name, holdersTotal, realFans, ghosts, attendancePct }) => ({ symbol, name, holdersTotal, realFans, ghosts, attendancePct }));
  // The specimen's rank and its line agree: seats go by time held, so rank 131 of 1,617 has held longer than 92%.
  const specimenRank = Math.max(1, Math.round(top.realFans * 0.081));
  const specimen: WalletTokenEntry = { symbol: top.symbol, usd: 0, kind: 'real', rank: specimenRank, of: top.realFans, bestStat: { key: 'longestHold', label: 'Longest hold', pct: Math.max(1, Math.round((specimenRank / Math.max(1, top.realFans)) * 100)) } };
  const seats = tokens.reduce((a, t) => a + t.realFans, 0);
  const sumSold = tokens.reduce((a, t) => a + t.holdersTotal, 0);
  const lastWeek = stats.weeklyBuyers[stats.weeklyBuyers.length - 1];
  const median = lastWeek && lastWeek.medianBuyUsd > 0 ? lastWeek.medianBuyUsd : null;
  const top10 = tokens.slice(0, 7).map((t) => t.top10SharePct).filter((n) => isFinite(n));
  const rail = tokens.filter((t) => t.realFans > 0).slice(0, 12);

  return (
    <>
      <main id="main">
        <section className="hero wrap" aria-label="The Ground">
          <GroundStage
            mode="hero"
            clubs={clubs}
            tabs={tabs}
            initial={top.symbol}
            examples={examples}
            pitch={TAGLINE}
            lede={
              <>
                <strong className="num">{fmtInt(stats.realWallets)}</strong> real fans hold a seat across {tokens.length} stock grounds on Base{lastWeek ? <>, and <span className="num">{fmtInt(lastWeek.newBuyers)}</span> wallets bought for the first time last week</> : ''}. Every wallet holding a stock token is a seat in that stock&rsquo;s ground. The lit seats are the fans who are really there.
              </>
            }
          />
        </section>

        <section className="wrap how-strip" aria-label="How Tropa Club works">
          <ol>
            <li><b>1</b><span>Start a club with your group chat</span></li>
            <li><b>2</b><span>Each member buys from their own wallet</span></li>
            <li><b>3</b><span>Matchday scores the week</span></li>
          </ol>
        </section>

        <section className="band" id="truth">
          <div className="wrap split">
            <div className="split-text">
              <h2>Who is in the ground</h2>
              <p>
                {fmtInt(top.realFans)} wallets hold at least $10 of {top.symbol}, bought it themselves and belong to a person. Those are the seats lit in the plan above. Separately, {fmtInt(top.newBuyers7d)} wallets bought {top.symbol} for the first time in the last week, and some of them are already in that count.
              </p>
              <p>
                An explorer counts every wallet with a balance above zero: {fmtInt(top.holdersTotal)} for {top.symbol}. Most of the difference is leftovers worth cents, giveaway recipients and contracts. Counting the fans apart gives an attendance of <strong className="num">{fmtPct(top.attendancePct)}</strong>, and a number that can grow for the right reason.
              </p>
              <p><Link className="tap" href="/about#method">How each kind is told apart</Link></p>
            </div>
            <GateReport token={top} />
          </div>
        </section>

        <section className="wrap section" id="find">
          <div className="split split-ticket">
            <div className="split-text">
              <h2>Your seat comes with a matchday ticket</h2>
              <p>
                Paste any wallet. If it is one of the real fans, it gets a ticket for each ground it sits in: block, row and seat in that ground, and the one thing it does better than most of the crowd.
              </p>
              <ul className="ticks">
                <li>Seats go by time held, then by who arrived first. Never by how much you hold.</li>
                <li>The barcode is cut from the bytes of your address. No two are alike.</li>
                <li>No dollar amounts are printed, so a ticket is safe to share.</li>
              </ul>
              <SeatSearchBox label="Paste a wallet to print its ticket" button="Print ticket" note="Read-only. Nothing to connect or sign." />
            </div>
            <div className="ticket-stage">
              <Ticket address={SPECIMEN} entry={specimen} token={top} asOf={index.asOf} specimen headingLevel={3} />
              <p className="caption">A specimen for {clubName(top.name)}. Real tickets carry the wallet&rsquo;s own seat.</p>
            </div>
          </div>
        </section>

        <section className="band clubs-only" id="clubs">
          <div className="wrap">
            <div className="section-head">
              <h2>The fans form clubs</h2>
              <p>
                Tropa Club is a free investing club for your group chat. Everyone puts $10 a week into stock tokens, each from their own wallet, and the club keeps the score, the streaks and the cost basis straight.
              </p>
              <p className="opens"><span className="tag">Buying opens {OPENS}</span> Found a club and fill the Bench today.</p>
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
                <h3>Start a club</h3>
                <p>A private club for your group chat, or get matched into a pick-up club of five. Each club hangs its own pennant.</p>
              </li>
              <li>
                <div className="step-art" aria-hidden="true"><span className="tenner"><b>$10</b><small>a week</small></span></div>
                <h3>Put in $10 a week</h3>
                <p>Each member buys from their own wallet, paid in {PAY_WITH}. {RULE_LINE} Tropa Club never holds the money and takes no fee.</p>
              </li>
              <li>
                <div className="step-art" aria-hidden="true">
                  <span className="board"><b>4</b><small>Played</small><b>1</b><small>Bench</small></span>
                </div>
                <h3>Play the Matchday</h3>
                <p>Buy in a gameweek and you played it. The Matchday card shows who played and who sat on the Bench. Fixtures are bragging rights only: no prize depends on returns.</p>
              </li>
              <li>
                <div className="step-art" aria-hidden="true">
                  <span className="bench"><i /><i /><i /><i /><i className="called" /></span>
                </div>
                <h3>Call up the Bench</h3>
                <p>One tap sends a benched teammate a nudge on WhatsApp or Telegram: we need you this week.</p>
              </li>
            </ol>
            <div className="preview-head">
              <h3>What a Matchday looks like</h3>
              <p>Four of five have bought this week. One is on the Bench. Call them up.</p>
            </div>
            <ClubPreview />
            <p className="after-table club-cta">
              <Link className="btn btn-accent" href="/clubs#start">Found a club</Link>
              <Link className="btn" href="/clubs#join">Join with an invite</Link>
              <Link className="btn" href="/league">See the league</Link>
            </p>
            <p className="muted small">The ground, the tickets and The Attendance are open everywhere.</p>
          </div>
        </section>

        <section className="wrap section" id="attendance">
          <div className="section-head">
            <h2>The Attendance</h2>
            <p>
              The league table of real holders for all {tokens.length} stock tokens on Base, counted again every 6 hours. Here is the top of it.
            </p>
          </div>
          <AttendanceTable rows={tokens.slice(0, 7)} controls={false} />
          <p className="after-table"><Link className="btn" href="/attendance">See all {tokens.length} grounds</Link></p>
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
                <p>{fmtInt(sumSold)} tickets across {tokens.length} grounds, since many wallets hold more than one.</p>
              </div>
              <div>
                <dt>Wallets with a real-fan seat</dt>
                <dd className="num">{fmtInt(stats.realWallets)}</dd>
                <p>{fmtInt(seats)} real-fan seats held by {fmtInt(stats.realWallets)} wallets, since a wallet can sit in several grounds. {fmtInt(stats.realWallets100)} hold $100 or more.</p>
              </div>
              <div>
                <dt>Median weekly buy</dt>
                <dd className="num">{median != null ? fmtUsd(median, median < 100 ? 2 : 0) : '—'}</dd>
                <p>{median != null ? <>The middle buyer&rsquo;s total for the week of {fmtDate(lastWeek!.weekStart)}, bots removed. {median <= 25 ? 'Small and regular is the norm, which is where “$10 a week” comes from.' : 'Half of all buyers spent less than this.'}</> : 'Published with the next count.'}</p>
              </div>
              <div>
                <dt>Share held by the top 10 wallets</dt>
                <dd className="num">{top10.length ? `${Math.min(...top10).toFixed(0)}% to ${Math.max(...top10).toFixed(0)}%` : '—'}</dd>
                <p>In the biggest clubs. So nothing here is ranked by size: a whale and a tenner get the same kind of seat.</p>
              </div>
            </dl>
            <div className="split split-chart">
              <div className="split-text">
                <h3>New fans keep arriving</h3>
                <p>
                  {lastWeek ? <>In the week of {fmtDate(lastWeek.weekStart)}, {fmtInt(lastWeek.buyers)} wallets bought a stock token on a DEX, and {fmtInt(lastWeek.newBuyers)} of them had never bought one before.</> : 'Weekly buyer counts will appear here.'}{' '}
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
            <li><h3>A wallet is not a person</h3><p>One person can hold several wallets. &ldquo;Real fan&rdquo; means a wallet that passes the tests, nothing more.</p></li>
            <li><h3>The $10 line moves with price</h3><p>Dollar values use the DEX price at the time of the count. A wallet near the line can gain or lose its seat between counts.</p></li>
            <li><h3>Farmer-only is a judgement</h3><p>Giveaway contracts are labelled by how they behave. The labels and the excluded wallets are published so anyone can check them.</p></li>
            <li><h3>Nothing here is advice</h3><p>Attendance describes who holds a token today. It says nothing about what the price will do.</p></li>
            <li><h3>Seats can change</h3><p>The plan is redrawn at every count. A ticket is a record of one count, with its date printed on it.</p></li>
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
              <h2>Were you there?</h2>
              <p>{fmtInt(stats.realWallets)} wallets hold {fmtInt(seats)} real-fan seats. Paste yours and see where it sits.</p>
              <SeatSearchBox label="Wallet address or name" button="Find seat" />
              <p className="closing-links">
                <Link href="/attendance">The Attendance</Link>
                <Link href={groundPath(top.symbol)}>Walk {clubName(top.name)}</Link>
                <Link href="/about">How it works</Link>
              </p>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
