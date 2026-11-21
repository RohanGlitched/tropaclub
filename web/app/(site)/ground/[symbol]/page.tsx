import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import GroundStage from '@/components/GroundStage';
import GateReport from '@/components/GateReport';
import FrontRow from '@/components/FrontRow';
import { Pennant } from '@/components/ds/Pennant';
import { getToken } from '@/lib/server/data';
import { clubName, groundPath, kitFor } from '@/lib/clubs';
import { fmtDate, fmtInt, fmtPct, fmtUsd } from '@/lib/format';
import { buildLayout } from '@/lib/stadium';

export const revalidate = 300;
type Params = { params: Promise<{ symbol: string }> };

// Rendered on first visit, then served from cache and refreshed every five minutes.
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { symbol } = await params;
  const { token } = await getToken(decodeURIComponent(symbol));
  if (!token) return { title: 'Ground not found' };
  return {
    title: `${clubName(token.name)}: ${fmtInt(token.holdersTotal)} tickets sold, ${fmtInt(token.realFans)} fans showed up`,
    description: `The seating plan of ${token.symbol} holders on Base. ${fmtInt(token.realFans)} real fans from ${fmtInt(token.holdersTotal)} wallets: an attendance of ${fmtPct(token.attendancePct)}. Find your seat.`,
  };
}

export default async function GroundPage({ params }: Params) {
  const { symbol } = await params;
  const { token, index } = await getToken(decodeURIComponent(symbol));
  if (!token) notFound();
  const { data } = index;
  const kit = kitFor(token.symbol);
  const club = clubName(token.name);
  const pos = data.tokens.findIndex((t) => t.symbol === token.symbol) + 1;
  const L = buildLayout(token.holdersTotal);
  const priced = token.priceUsd != null;
  const others = data.tokens.filter((t) => t.symbol !== token.symbol && t.realFans > 0).slice(0, 11);
  const clubs = data.tokens.map(({ symbol: s, name, holdersTotal, realFans, ghosts, attendancePct }) => ({ symbol: s, name, holdersTotal, realFans, ghosts, attendancePct }));

  return (
    <>
      <main id="main">
        <section className="wrap page-head ground-head">
          <p className="crumbs"><Link href="/attendance">The Attendance</Link> <span aria-hidden="true">/</span> {priced ? `Position ${pos} of ${data.tokens.length}` : 'No price yet'}</p>
          <div className="ground-title">
            <span className="ground-pennant"><Pennant kit={kit} width={46} rail /></span>
            <div>
              <h1>{club}</h1>
              <p className="ground-line">
                <span className="num">{fmtInt(token.holdersTotal)}</span> tickets sold.{' '}
                {priced ? <><span className="num">{fmtInt(token.realFans)}</span> fans showed up.</> : 'No price yet, so the fans cannot be counted.'}
              </p>
            </div>
          </div>
          <p className="asof">
            Home ground of {token.symbol} holders on Base. {token.symbol} is a stock token that tracks the share price of {token.name}. Counted {fmtDate(data.asOf, true)}.
          </p>
        </section>

        <section className="wrap section-tight" aria-label={`Seating plan of ${club}`}>
          <GroundStage mode="ground" clubs={clubs} initial={token.symbol} />
        </section>

        <section className="band">
          <div className="wrap split">
            <div className="split-text">
              <h2>Through the turnstiles</h2>
              <p>
                {priced
                  ? <>Of {fmtInt(token.holdersTotal)} wallets with a balance, {fmtInt(token.realFans)} pass every test for a real fan. That is an attendance of <strong className="num">{fmtPct(token.attendancePct)}</strong>.</>
                  : <>{token.symbol} has no liquid market yet, so its holders cannot be valued in dollars and the $10 line cannot be drawn.</>}
              </p>
              <dl className="figures figures-2">
                <div><dt>Buyers, last 7 days</dt><dd className="num">{fmtInt(token.weeklyBuyers)}</dd><p>{fmtInt(token.newBuyers7d)} bought for the first time.</p></div>
                <div><dt>Median weekly buy</dt><dd className="num">{token.medianWeeklyBuyUsd != null ? fmtUsd(token.medianWeeklyBuyUsd) : '—'}</dd><p>Per wallet, bots removed.</p></div>
                <div><dt>Held by the top 10</dt><dd className="num">{fmtPct(token.top10SharePct, 0)}</dd><p>{fmtPct(token.top10ShareExPoolsPct, 0)} once pools are left out.</p></div>
                <div><dt>Token price</dt><dd className="num">{priced ? fmtUsd(token.priceUsd) : '—'}</dd><p>{priced ? `DEX price used for the $10 line${token.multiplier !== 1 ? `, multiplier ×${+token.multiplier.toFixed(4)}` : ''}.` : 'No liquid pool found.'}</p></div>
              </dl>
            </div>
            <GateReport token={token} />
          </div>
        </section>

        <section className="wrap section">
          <div className="split">
            <div className="split-text">
              <h2>The front row</h2>
              <p>The ten fans who have held {token.symbol} longest without selling out. Rank one sits pitchside on the halfway line. How much they hold plays no part.</p>
              <p className="muted small">Addresses are public blockchain records. Tap one to see its ticket.</p>
            </div>
            <FrontRow symbol={token.symbol} club={club} total={token.holdersTotal} realFans={token.realFans} />
          </div>
        </section>

        <section className="band">
          <div className="wrap">
            <div className="section-head">
              <h2>How this ground is laid out</h2>
              <p>
                {club} has {fmtInt(L.n)} seats in {L.rows} {L.rows === 1 ? 'row' : 'rows'}{L.rows >= 10 ? ', split into a lower and an upper tier' : ''}. A club&rsquo;s ground is built to hold exactly its holders, so a small club has a small ground.
              </p>
            </div>
            <ul className="limits limits-3">
              <li><h3>Best seats to the longest holders</h3><p>Fans are seated in order of unbroken days held, then by who bought first. The lower rows near halfway fill first and the crowd thins toward the back.</p></li>
              <li><h3>Ghosts get what is left</h3><p>Dust, farmer-only wallets and contracts take the remaining seats. They are drawn faint, because nobody is sitting there.</p></li>
              <li><h3>The crowd wears the kit</h3><p>Lit seats take the club&rsquo;s two colours in its kit pattern, so a full ground would show the whole design. The gaps are the story.</p></li>
            </ul>
          </div>
        </section>

        <section className="wrap section">
          <div className="section-head">
            <h2>Other grounds</h2>
          </div>
          <div className="grounds">
            {others.map((t) => (
              <Link key={t.symbol} href={groundPath(t.symbol)} className="ground-card" prefetch={false}>
                <Pennant kit={kitFor(t.symbol)} width={24} />
                <span>
                  <b>{clubName(t.name)}</b>
                  <small className="num">{fmtInt(t.realFans)} fans, {fmtPct(t.attendancePct)} attendance</small>
                </span>
              </Link>
            ))}
            <Link href="/attendance" className="ground-card ground-card-all"><span><b>All {data.tokens.length} clubs</b><small>The Attendance</small></span></Link>
          </div>
          <p className="muted small fine">
            &ldquo;{club}&rdquo; is a nickname for the holders of {token.symbol}. Tropa Club is not affiliated with {token.name}. Holding {token.symbol} is not owning the share. Past performance · not advice.
          </p>
        </section>
      </main>
    </>
  );
}
