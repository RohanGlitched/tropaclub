import type { Metadata } from 'next';
import Link from 'next/link';
import BuyCta from '@/components/buy/BuyCta';
import { buyOpenAt, buyState, groundName, notAffiliated } from '@/lib/site';
import { notFound } from 'next/navigation';
import GroundStage from '@/components/GroundStage';
import GateReport from '@/components/GateReport';
import FrontRow from '@/components/FrontRow';
import { Pennant } from '@/components/ds/Pennant';
import Term from '@/components/nav/Term';
import { Crumbs, NextStrip } from '@/components/nav/Wayfinding';
import { dataBaseUrl, getToken } from '@/lib/server/data';
import { groundPath, kitFor, shortName } from '@/lib/clubs';
import { fmtDate, fmtInt, fmtPct, fmtUsd } from '@/lib/format';
import { buildLayout } from '@/lib/stadium';
import { PRE_IPO_TAG, isPreIpo, preIpoPriceNote } from '@/lib/preipo';

export const revalidate = 300;
type Params = { params: Promise<{ symbol: string }> };

// Rendered on first visit, then served from cache and refreshed every five minutes.
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { symbol } = await params;
  const { token } = await getToken(decodeURIComponent(symbol));
  if (!token) return { title: 'Page not found' };
  return {
    title: `${groundName(token.name, token.symbol)}: ${fmtInt(token.holdersTotal)} wallets hold ${token.symbol}, ${fmtInt(token.realFans)} are real holders`,
    description: `The ${fmtInt(token.holdersTotal)} wallets holding ${token.symbol}, ${shortName(token.name, token.symbol)}’s stock token on Base, drawn as a stadium. ${fmtInt(token.realFans)} are real holders (${fmtPct(token.attendancePct)}). Check your wallet.`,
  };
}

export default async function GroundPage({ params }: Params) {
  const { symbol } = await params;
  const { token, index } = await getToken(decodeURIComponent(symbol));
  if (!token) notFound();
  const { data } = index;
  const kit = kitFor(token.symbol);
  const club = groundName(token.name, token.symbol);
  const company = shortName(token.name, token.symbol);
  const pos = data.tokens.findIndex((t) => t.symbol === token.symbol) + 1;
  const L = buildLayout(token.holdersTotal);
  const priced = token.priceUsd != null;
  const preIpo = isPreIpo(token.symbol);
  const seatsBase = index.source === 'live' ? dataBaseUrl : null;
  const others = data.tokens.filter((t) => t.symbol !== token.symbol && t.realFans > 0).slice(0, 11);
  const clubs = data.tokens.map(({ symbol: s, name, holdersTotal, realFans, ghosts, attendancePct }) => ({ symbol: s, name, holdersTotal, realFans, ghosts, attendancePct }));

  return (
    <>
      <main id="main">
        <section className="wrap page-head ground-head">
          <Crumbs trail={[{ label: 'Stock rankings', href: '/attendance' }, { label: club }]} note={priced ? `Rank ${pos} of ${data.tokens.length}` : 'No price yet'} />
          <div className="ground-title">
            <span className="ground-pennant"><Pennant kit={kit} width={46} rail /></span>
            <div>
              <h1>{club}</h1>
              {preIpo && <p className="preipo"><span className="tag tag-quiet">{PRE_IPO_TAG}</span> {preIpoPriceNote(token)}</p>}
              <p className="ground-line">
                <span className="num">{fmtInt(token.holdersTotal)}</span> holders.{' '}
                {priced ? <><span className="num">{fmtInt(token.realFans)}</span> real holders ({fmtPct(token.attendancePct)}).</> : 'No price yet, so the real holders cannot be counted.'}
              </p>
            </div>
          </div>
          <p className="asof">
            The {fmtInt(token.holdersTotal)} wallets holding {token.symbol}, {company}&rsquo;s <Term id="stock-token">stock token</Term> on Base, drawn as a stadium (a <Term id="ground">ground</Term>). Each dot is one wallet. Bright seats are <Term id="real-fan">real holders</Term>; faint ones hold under $10, only got an airdrop, or are a contract. Counted {fmtDate(data.asOf, true)}, and again every 6 hours.
          </p>
        </section>

        <section className="wrap section-tight" aria-label={`The ${club}`}>
          {/* the seat list starts downloading with the page, straight from the public file */}
          {seatsBase && <link rel="preload" as="fetch" crossOrigin="anonymous" href={`${seatsBase}/tokens/${encodeURIComponent(token.symbol)}.json`} />}
          <GroundStage mode="ground" clubs={clubs} initial={token.symbol} seatsBase={seatsBase} />
        </section>

        {priced && (
          <section className="wrap section-tight take-seat" aria-label={`Become a real holder of ${token.symbol}`}>
            <div>
              <h2 className="h3">Become a real holder: buy $10 of {token.symbol}</h2>
              <p>You&rsquo;d be about real holder number {fmtInt(token.realFans + 1)} at the next count (every 6 hours). Ranked by how long you&rsquo;ve held, not how much. Buying here is optional: $10 or more of {token.symbol} held in any wallet of your own counts, and no club is needed.</p>
            </div>
            <BuyCta token={token.address} symbol={token.symbol} state={buyState()} openAt={buyOpenAt()} standalone />
          </section>
        )}

        <section className="band">
          <div className="wrap split">
            <div className="split-text">
              <h2>How we count</h2>
              <p>
                {priced
                  ? <>Of {fmtInt(token.holdersTotal)} wallets with a balance, {fmtInt(token.realFans)} pass every test for a real holder. That is a real share (<Term id="attendance">attendance</Term>) of <strong className="num">{fmtPct(token.attendancePct)}</strong>.</>
                  : <>{token.symbol} has no liquid market yet, so its holders cannot be valued in dollars and the $10 line cannot be drawn.</>}
              </p>
              <dl className="figures figures-2">
                <div><dt>Buyers, last 7 days</dt><dd className="num">{fmtInt(token.weeklyBuyers)}</dd><p>{fmtInt(token.newBuyers7d)} bought for the first time. Buyers in 7 days can be more than holders: some bought and sold again.</p></div>
                <div><dt>Median weekly buy</dt><dd className="num">{token.medianWeeklyBuyUsd != null ? fmtUsd(token.medianWeeklyBuyUsd) : '—'}</dd><p>The middle buyer&rsquo;s total for the week, bots removed.</p></div>
                <div><dt>Held by the top 10 wallets</dt><dd className="num">{fmtPct(token.top10SharePct, 0)}</dd><p>Top 10 wallets hold {fmtPct(token.top10SharePct, 0)} of {token.symbol} ({fmtPct(token.top10ShareExPoolsPct, 0)} without exchange pools).</p></div>
                <div><dt>Token price</dt><dd className="num">{priced ? fmtUsd(token.priceUsd) : '—'}</dd><p>{preIpo ? preIpoPriceNote(token) : !priced ? 'No liquid pool found.' : token.priceSource === 'reference' ? `Reference price: no active market, so we use the share’s last price${token.multiplier !== 1 ? ` times a ×${+token.multiplier.toFixed(4)} adjustment for splits and dividends paid as tokens` : ''}. The $10 line is approximate.` : `Exchange price used for the $10 line${token.multiplier !== 1 ? `. It includes a ×${+token.multiplier.toFixed(4)} adjustment for dividends paid as tokens` : ''}.`}</p></div>
              </dl>
            </div>
            <GateReport token={token} />
          </div>
        </section>

        <section className="wrap section">
          <div className="split">
            <div className="split-text">
              <h2>Longest holders</h2>
              <p>The 10 wallets that have held {token.symbol} longest without emptying their wallet of it. Amount doesn&rsquo;t matter. Rank one sits pitchside on the halfway line of the drawing.</p>
              <p className="muted small">Addresses are public blockchain records. Tap one to see its ticket.</p>
            </div>
            <FrontRow symbol={token.symbol} club={club} total={token.holdersTotal} realFans={token.realFans} seatsBase={seatsBase} />
          </div>
        </section>

        <section className="band">
          <div className="wrap">
            <div className="section-head">
              <h2>How this ground is laid out</h2>
              <p>
                The {club} has {fmtInt(L.n)} seats in {L.rows} {L.rows === 1 ? 'row' : 'rows'}{L.rows >= 10 ? ', split into a lower and an upper tier' : ''}: one seat per holder. Each ground is drawn to hold exactly its holders, so a token with few holders gets a small ground.
              </p>
            </div>
            <ul className="limits limits-3">
              <li><h3>Best seats to the longest holders</h3><p>Real holders are seated in order of unbroken days held, then by who bought first. The lower rows near halfway fill first and the crowd thins toward the back.</p></li>
              <li><h3>Other holders fill the rest, drawn faint</h3><p>Wallets under $10, airdrop-only wallets and contracts take the remaining seats as <Term id="ghost-seat">ghost seats</Term>. They are drawn faint, because nobody is really there.</p></li>
              <li><h3>Lit seats use the ground&rsquo;s colours</h3><p>Real holders take the ground&rsquo;s two colours in its pattern, so a full ground would show the whole design. The gaps are the story.</p></li>
            </ul>
          </div>
        </section>

        <section className="wrap section">
          <div className="section-head">
            <h2>Other stock tokens</h2>
          </div>
          <div className="grounds">
            {others.map((t) => (
              <Link key={t.symbol} href={groundPath(t.symbol)} className="ground-card" prefetch={false}>
                <Pennant kit={kitFor(t.symbol)} width={24} />
                <span>
                  <b>{groundName(t.name, t.symbol)}</b>
                  <small className="num">{fmtInt(t.realFans)} real holders, {fmtPct(t.attendancePct)} real</small>
                </span>
              </Link>
            ))}
            <Link href="/attendance" className="ground-card ground-card-all"><span><b>All {data.tokens.length} stock tokens</b><small>Stock rankings</small></span></Link>
          </div>
          <p className="muted small fine">
            {notAffiliated(token.name)} The &ldquo;{club}&rdquo; is our drawing of the holders of {token.symbol}. Holding {token.symbol} is not owning the share.
          </p>
        </section>

        <NextStrip
          items={[
            { title: 'See your ticket', sub: 'Your rank in every ground you are in', mine: 'ticket' },
            { title: 'Start a club with friends', sub: 'Your group chat, about $10 a week each, from your own wallets', href: '/clubs#start' },
          ]}
        />
      </main>
    </>
  );
}
