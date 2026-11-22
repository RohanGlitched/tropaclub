import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { WalletTokenEntry } from '@shared/types';
import Ticket from '@/components/ds/Ticket';
import ShareBar from '@/components/ShareBar';
import SeatSearchBox from '@/components/SeatSearchBox';
import BuyCta from '@/components/buy/BuyCta';
import { Pennant } from '@/components/ds/Pennant';
import Term from '@/components/nav/Term';
import { Crumbs, NextStrip } from '@/components/nav/Wayfinding';
import PageSections from '@/components/nav/PageSections';
import Anchor from '@/components/nav/Anchor';
import { getIndex, getNeighbours, getWallet } from '@/lib/server/data';
import { playedStamps, tryClubs } from '@/lib/server/clubs';
import { honourStamps, walletHonours } from '@/lib/server/honours';
import { sessionWallet } from '@/lib/server/session';
import { groundPath, kitFor, shortName } from '@/lib/clubs';
import { fmtDate, fmtInt, isAddress, shortAddr } from '@/lib/format';
import { KIND_LABEL, statSentence } from '@/lib/ticket';
import { ticketOgVersion } from '@/lib/og';
import { honoursTagOf } from '@/lib/server/cardmake';
import { COUNT_EVERY, PLAY_USD, SITE_URL, buyOpenAt, buyState, capsPointsLine, groundName, notAffiliated, openClubName, scoutUrl } from '@/lib/site';

// Rendered per request: any address can be asked for, so nothing is stored per wallet.
export const dynamic = 'force-dynamic';
type Params = { params: Promise<{ address: string }> };

async function load(raw: string) {
  const address = raw.toLowerCase();
  if (!isAddress(address)) return { address, valid: false as const };
  const [index, wallet] = await Promise.all([getIndex(), getWallet(address)]);
  const bySymbol = new Map(index.data.tokens.map((t) => [t.symbol, t]));
  const held = (wallet.data?.tokens ?? []).filter((e) => bySymbol.has(e.symbol));
  const real = held.filter((e) => e.rank != null).sort((a, b) => a.rank! / Math.max(1, a.of) - b.rank! / Math.max(1, b.of));
  const ghosts = held.filter((e) => e.rank == null).sort((a, b) => b.usd - a.usd);
  return { address, valid: true as const, index, wallet, bySymbol, real, ghosts };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { address: raw } = await params;
  const d = await load(raw);
  const robots = { index: false, follow: true };
  if (!d.valid) return { title: 'Page not found', robots };
  const top = d.real[0];
  if (!top) {
    const title = 'Become a real holder: pick a ground';
    return { title, description: `${shortAddr(d.address)} is not a real holder of any stock token yet. That needs $10 or more of one stock token, bought and held in your own wallet.`, robots };
  }
  const token = d.bySymbol.get(top.symbol)!;
  const title = `Ticket: ${groundName(token.name, token.symbol)}, real holder ${fmtInt(top.rank!)} of ${fmtInt(top.of || token.realFans)}`;
  const description = `${statSentence(top.bestStat)}. ${shortAddr(d.address)} is a real holder of ${d.real.length === 1 ? '1 stock token' : `${d.real.length} stock tokens`}. Check yours.`;
  // This wallet's own ticket picture, drawn on demand by /api/card/og and stored (see that route).
  // The version changes with each count and with a new "Played" stamp, so each URL can be cached long.
  // (and with a new scout badge or First 1,000 stamp: the same version the og route expects)
  const [played, h] = await Promise.all([playedStamps(d.address, 1500), walletHonours(d.address)]);
  const image = `${SITE_URL}/api/card/og/${d.address}.jpg?v=${encodeURIComponent(ticketOgVersion(d.index.data.asOf, played.byToken.get(token.address.toLowerCase()) ?? null, honoursTagOf(h)))}`;
  return {
    title,
    description,
    robots,
    openGraph: { title, description, url: `/ticket/${d.address}`, images: [{ url: image, width: 1200, height: 630, alt: title }] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}

const ghostWhy = (e: WalletTokenEntry) => (e.kind === 'dust' ? 'holds under $10' : e.kind === 'farmer' ? 'only received a giveaway, never bought' : 'a contract, not a person');

export default async function TicketPage({ params }: Params) {
  const { address: raw } = await params;
  const d = await load(raw);

  if (!d.valid) notFound();

  const { address, index, bySymbol, real, ghosts } = d;
  const pageUrl = `${SITE_URL}/ticket/${address}`;
  const openAt = buyOpenAt();
  const state = buyState();
  const isCode = ghosts.length > 0 && ghosts.every((g) => g.kind === 'contract' || g.kind === 'pool');
  // Never pick a stock for the visitor. The grounds offered: the ones this wallet already has a ghost
  // seat in (under $10, or only a giveaway), then the biggest grounds, six in all.
  const near = ghosts.find((g) => g.kind === 'dust' || g.kind === 'farmer');
  const own = ghosts.filter((g) => g.kind === 'dust' || g.kind === 'farmer');
  const pick = [
    ...own.map((g) => ({ token: bySymbol.get(g.symbol)!, mine: g.kind })),
    ...index.data.tokens.filter((t) => t.realFans > 0 && !own.some((g) => g.symbol === t.symbol)).map((t) => ({ token: t, mine: null as string | null })),
  ].slice(0, 6);
  // the preview ticket: the wallet's own ghost seat if it has one, else the biggest ground as an example
  const sample = pick[0]?.token ?? index.data.tokens[0];
  const crumbs = [{ label: 'Grounds', href: groundPath(index.data.tokens[0].symbol) }, { label: <span className="num">{shortAddr(address)}</span> }];
  const top = real[0];
  const topToken = top ? bySymbol.get(top.symbol)! : null;
  const [neighbours, played, honours, viewer] = await Promise.all([
    top && topToken ? getNeighbours(top.symbol, top.rank!) : null,
    real.length ? playedStamps(address) : null,
    walletHonours(address),
    sessionWallet().catch(() => null),
  ]);
  const stamps = honourStamps(honours);
  // Your own ticket: the share post carries your scout link, and the shared page keeps ?s=<code>
  // so the preview stays this ticket. Anyone else's ticket is shared as it is.
  const code = viewer === address ? await tryClubs((svc) => svc.scoutCode(address), 2500) : null;
  const shareUrl = code ? `${pageUrl}?s=${code}` : pageUrl;
  const honoursNote = (stamps.length > 0 || honours.caps) && (
    <p className="caps-line">
      {[...stamps, ...(honours.caps ? [capsPointsLine(honours.caps)] : [])].join('. ')}.{' '}
      {honours.caps && <Link href="/league?tab=caps" prefetch={false}>The points (Caps) table</Link>}
    </p>
  );

  return (
    <main id="main">
      <PageSections
        sections={
          real.length > 0
            ? [
                { id: 'tickets', label: real.length === 1 ? 'Ticket' : 'Tickets' },
                { id: 'next', label: 'Buy with friends' },
                ...(neighbours && neighbours.length > 0 ? [{ id: 'neighbours', label: 'Ranked next to it' }] : []),
                ...(ghosts.length > 0 || real.length > 1 ? [{ id: 'holdings', label: 'Every token it holds' }] : []),
                { id: 'check', label: 'Check another wallet' },
              ]
            : isCode
              ? [{ id: 'holdings', label: 'What it holds' }, { id: 'check', label: 'Check another wallet' }]
              : [
                  { id: 'pick', label: 'Pick a ground' },
                  { id: 'real', label: 'What makes a real holder' },
                  ...(ghosts.length > 0 ? [{ id: 'holdings', label: 'What it holds' }] : []),
                  { id: 'check', label: 'Check another wallet' },
                ]
        }
      />
      {real.length > 0 && topToken ? (
        <>
          <section className="wrap page-head">
            <Crumbs trail={crumbs} />
            <h1><span className="num addr">{shortAddr(address)}</span> is a real {real.length === 1 ? `${shortName(topToken.name, topToken.symbol)} holder` : `holder of ${real.length} stock tokens`}</h1>
            <p className="lede">
              This wallet is a <Term id="real-fan">real holder</Term> of {real.length === 1 ? `${topToken.symbol}` : `${real.length} stock tokens`}: $10 or more, bought itself, a person&rsquo;s wallet. Each <Term id="ticket">ticket</Term> shows where it ranks among that token&rsquo;s real holders, by how long they&rsquo;ve held, and its best stat. The ticket itself shows no dollar amounts. Like any wallet, its history is public on Base. It is a picture, not an NFT, and has no value. <Link href="/about#method">What “real” means</Link>
            </p>
            {honours.caps && (
              <p className="caps-line">
                {capsPointsLine(honours.caps)} <Link href="/league?tab=caps" prefetch={false}>on the points (Caps) table</Link>
              </p>
            )}
            <p className="asof">Counted {fmtDate(index.data.asOf, true)}, and again {COUNT_EVERY}.</p>
          </section>
          <section className="wrap tickets" id="tickets" aria-label="Tickets">
            {real.map((e, i) => {
              const token = bySymbol.get(e.symbol)!;
              return (
                <div key={e.symbol} className="ticket-block">
                  <div className="ticket-stage">
                    <Ticket address={address} entry={e} token={token} asOf={index.data.asOf} headingLevel={2} printIn={i === 0} stamp={played?.byToken.get(token.address.toLowerCase()) ?? null} badge={played?.badge} honours={stamps} />
                  </div>
                  <div className="ticket-actions">
                    <ShareBar address={address} symbol={e.symbol} club={groundName(token.name, token.symbol)} line={statSentence(e.bestStat)} pageUrl={shareUrl} scoutLink={code ? scoutUrl(code) : null} />
                    <Link className="btn" href={groundPath(e.symbol)}>See it in the stadium drawing</Link>
                    {i === 0 && <Link className="btn" href={`/statement/${address}`} prefetch={false}>Cost-basis statement</Link>}
                  </div>
                  {i === 0 && real.length > 1 && <p className="tickets-more">More tickets for this wallet</p>}
                </div>
              );
            })}
          </section>

          <section className="band" id="next">
            <div className="wrap">
              <div className="section-head">
                <h2>Next: buy with friends<Anchor id="next" label="Buy with friends" /></h2>
                <p>Clubs turn holding into a weekly habit with the people you already talk to. Each person buys from their own wallet; there is no shared pot.</p>
              </div>
              <ul className="next-steps">
                <li>
                  <h3>Join the {openClubName(topToken.name, topToken.symbol)}</h3>
                  <p>Every stock token has an <Term id="stock-club">open club</Term> anyone can join for free. Each week you buy ${PLAY_USD} or more of {topToken.symbol} through Tropa Club, you count toward its weekly score.</p>
                  <Link className="btn btn-accent" href={`/club/stock-${topToken.symbol.toLowerCase()}`} prefetch={false}>See the {openClubName(topToken.name, topToken.symbol)}</Link>
                </li>
                <li>
                  <h3>Start a club with friends</h3>
                  <p>Name a club, get an invite link for the group chat. Everyone buys from their own wallet, and Tropa Club shows who bought each week.</p>
                  <Link className="btn" href="/clubs#start">Start a club</Link>
                </li>
                <li>
                  <h3>Get the &ldquo;Played&rdquo; stamp</h3>
                  <p>Buy ${PLAY_USD} or more through Tropa Club in a week (a <Term id="gameweek">gameweek</Term>) and this ticket gets a &ldquo;Played&rdquo; stamp for that week, starting with week 0 (GW0), and it counts toward your <Term id="payday-streak">payday streak</Term>.</p>
                  <BuyCta token={topToken.address} symbol={topToken.symbol} state={state} openAt={openAt} standalone compact label={`Buy $10 more of ${topToken.symbol}`} />
                </li>
              </ul>
            </div>
          </section>

          {neighbours && neighbours.length > 0 && top && (
            <section className="wrap section-tight" id="neighbours">
              <h2 className="h3">Wallets ranked next to this one<Anchor id="neighbours" label="Wallets ranked next to this one" /></h2>
              <p className="muted">The real holders of {topToken.symbol} either side of real holder {fmtInt(top.rank!)}. Ranked by time held, never by size.</p>
              <ul className="ghost-list neighbours">
                {neighbours.map((n) => (
                  <li key={n.address}>
                    <Pennant kit={kitFor(topToken.symbol)} width={18} />
                    <Link href={`/ticket/${n.address}`} prefetch={false} className="num">{shortAddr(n.address)}</Link>
                    <span>Real holder {fmtInt(n.rank)}, {n.rank < top.rank! ? 'has held longer' : 'arrived after'}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      ) : isCode ? (
        <section className="wrap page-head empty">
          <Crumbs trail={crumbs} />
          <div className="gate-shut" aria-hidden="true">
            {Array.from({ length: 28 }, (_, i) => <i key={i} />)}
          </div>
          <h1><span className="num addr">{shortAddr(address)}</span> is a contract, not a real holder</h1>
          <p className="lede">This address is a contract, such as a pool, vault or router. It holds stock tokens, but it is code, not a person, so it shows as a <Term id="ghost-seat">ghost seat</Term> and gets no ticket.</p>
          <p className="closing-links"><Link className="btn" href={groundPath(ghosts[0].symbol)}>See the stadium drawing</Link><Link href="/attendance">Stock rankings</Link></p>
        </section>
      ) : (
        <section className="wrap page-head convert" id="pick">
          <div className="convert-text">
            <Crumbs trail={crumbs} />
            <p className="hero-pitch">Not a real holder yet</p>
            <h1>Become a real holder: pick a ground</h1>
            <p className="lede">
              {near
                ? near.kind === 'dust'
                  ? `This wallet already holds ${near.symbol}, just under the $10 line, so it has a ghost seat in that ground.`
                  : `This wallet was sent ${near.symbol} in a giveaway but has never bought it, so it has a ghost seat in that ground.`
                : <>This wallet holds no <Term id="stock-token">stock tokens</Term> on Base yet.</>}{' '}
              Any ground works: once the wallet holds $10 or more of that token, bought itself, the next count gives it a <Term id="ticket">ticket</Term> there. We recount {COUNT_EVERY} and rank by time held, so the newest holder starts at the back and moves forward by holding.
            </p>
            <ul className="pick-grounds" aria-label="Grounds to pick from">
              {pick.map(({ token: t, mine }) => (
                <li key={t.symbol}>
                  <Link className="pick-ground" href={groundPath(t.symbol)} prefetch={false}>
                    <Pennant kit={kitFor(t.symbol)} width={22} />
                    <span>
                      <b>{groundName(t.name, t.symbol)}</b>
                      <small>{mine === 'dust' ? 'You hold some, under $10' : mine === 'farmer' ? 'You were sent some in a giveaway' : <><span className="num">{fmtInt(t.realFans)}</span> real holders</>}</small>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="pick-more"><Link href="/attendance">All {index.data.tokens.length} stock tokens</Link></p>
            {honoursNote}
            <p className="muted small">Each ground&rsquo;s page has its own buy button. Buying is optional: holding $10 or more in any wallet of your own counts. A stock token tracks the share price; it is not the share. Not advice.</p>
          </div>
          <div className="convert-ticket">
            <Ticket address={address} entry={{ symbol: sample.symbol, usd: 10, kind: 'real', rank: sample.realFans + 1, of: sample.realFans + 1, bestStat: null }} token={sample} headingLevel={2} preview />
            <p className="caption">{own.length ? `A preview for the ${groundName(sample.name, sample.symbol)}, where this wallet already has a ghost seat.` : `A preview, using the biggest ground as an example. Every ground's ticket looks like this.`} The real ticket, with its exact rank, appears at the first count after the wallet holds $10.</p>
          </div>
        </section>
      )}

      {real.length === 0 && !isCode && (
        <section className="band" id="real">
          <div className="wrap split">
            <div className="split-text">
              <h2>What makes a real holder<Anchor id="real" label="What makes a real holder" /></h2>
              <ul className="ticks">
                <li>$10 or more of one stock token, held in a wallet a person controls.</li>
                <li>At least one purchase. Tokens that were only sent by a giveaway do not count.</li>
                <li>A count. Real holders are counted again {COUNT_EVERY}.</li>
              </ul>
            </div>
            <div className="split-text">
              <h2>Or buy with friends</h2>
              <p>A <Term id="club">club</Term> is you and your friends each buying about $10 of stock tokens a week from your own wallets. Tropa Club shows who bought and keeps your streaks. There is no shared pot.</p>
              <p className="closing-links"><Link className="btn" href="/clubs#start">Start a club</Link><Link href="/clubs">How clubs work</Link></p>
            </div>
          </div>
        </section>
      )}

      {(ghosts.length > 0 || real.length > 1) && (
        <section className="wrap section-tight" id="holdings">
          <h2 className="h3">{real.length > 0 ? 'Every stock token this wallet holds' : 'What this wallet holds'}<Anchor id="holdings" label="Every stock token this wallet holds" /></h2>
          <p className="muted">{real.length > 0 ? 'Tokens it is a real holder of first, then holdings that do not count as real.' : 'Holdings that do not count as a real holder, and why.'}</p>
          <ul className="ghost-list">
            {[...real, ...ghosts].map((e) => {
              const token = bySymbol.get(e.symbol)!;
              return (
                <li key={e.symbol}>
                  <Pennant kit={kitFor(e.symbol)} width={18} />
                  <Link href={groundPath(e.symbol)} prefetch={false}>{groundName(token.name, token.symbol)}</Link>
                  <span>{e.rank != null ? `Real holder ${fmtInt(e.rank)} of ${fmtInt(e.of || token.realFans)}` : `Not counted as real (${(KIND_LABEL[e.kind] ?? 'ghost seat').toLowerCase()}): ${ghostWhy(e)}`}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className={real.length === 0 && !isCode ? 'wrap section' : 'band'} id="check">
        <div className={real.length === 0 && !isCode ? 'split' : 'wrap split'}>
          <div className="split-text">
            <h2>{real.length > 0 ? 'Not your wallet? Paste yours' : 'Try another wallet'}<Anchor id="check" label="Check another wallet" /></h2>
            <p>Any address on Base works. Nothing to connect, nothing to sign.</p>
            <SeatSearchBox label="Wallet address or name" button="Check wallet" />
          </div>
          <div className="split-text">
            <h2>How to read a ticket</h2>
            <dl className="defs">
              <div><dt>Block, row, seat</dt><dd>Your spot in the stadium drawing of that token&rsquo;s holders. Lower rows near halfway go to the longest holders.</dd></div>
              <div><dt>Real holder number</dt><dd>Rank among that token&rsquo;s real holders by unbroken days held, then by first buy. Never by size.</dd></div>
              <div><dt>The bold line</dt><dd>This wallet&rsquo;s best stat: hold time, arrival, entry price against the median real holder, or <Term id="weekly-run">weeks in a row</Term> its balance grew. That last one is counted for every holder from public Base data, so it is not the club payday streak.</dd></div>
              <div><dt>Barcode</dt><dd>Drawn from the bytes of the address. It is a pattern, not a code anyone can scan for value.</dd></div>
            </dl>
          </div>
        </div>
      </section>

      <section className="wrap section-tight">
        <p className="muted small fine">
          {notAffiliated((real.length ? real : ghosts.length && isCode ? ghosts : pick.map((p) => p.token)).slice(0, 6).map((e) => bySymbol.get(e.symbol)?.name ?? ''))}
        </p>
      </section>

      <NextStrip
        items={[
          { title: 'Start a club with friends', sub: 'Your group chat, about $10 a week each, from your own wallets', href: '/clubs#start' },
          { title: 'Club rankings', sub: 'Club scores and weekly rankings', href: '/league' },
        ]}
      />
    </main>
  );
}
