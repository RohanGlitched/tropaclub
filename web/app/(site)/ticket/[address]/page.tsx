import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { WalletTokenEntry } from '@shared/types';
import Ticket from '@/components/ds/Ticket';
import ShareBar from '@/components/ShareBar';
import SeatSearchBox from '@/components/SeatSearchBox';
import BuyCta from '@/components/buy/BuyCta';
import { Pennant } from '@/components/ds/Pennant';
import { getIndex, getNeighbours, getWallet } from '@/lib/server/data';
import { playedStamps } from '@/lib/server/clubs';
import { clubName, groundPath, kitFor } from '@/lib/clubs';
import { fmtDate, fmtInt, isAddress, shortAddr } from '@/lib/format';
import { KIND_LABEL, statSentence } from '@/lib/ticket';
import { ticketOgVersion } from '@/lib/og';
import { COUNT_EVERY, RULE_LINE, SITE_URL, buyOpenAt, notAffiliated } from '@/lib/site';

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
  if (!d.valid) return { title: 'No such seat', robots };
  const top = d.real[0];
  if (!top) {
    const t = d.index.data.tokens[0];
    const title = `Take a seat at ${clubName(t.name)} for $10`;
    return { title, description: `${shortAddr(d.address)} has no real-fan seat yet. A seat needs $10 of one stock token, held in your own wallet.`, robots };
  }
  const token = d.bySymbol.get(top.symbol)!;
  const title = `Matchday ticket: ${clubName(token.name)}, real fan ${fmtInt(top.rank!)} of ${fmtInt(top.of || token.realFans)}`;
  const description = `${statSentence(top.bestStat)}. ${shortAddr(d.address)} has ${d.real.length === 1 ? 'a seat' : `${d.real.length} seats`} in The Ground. Find yours.`;
  // This wallet's own ticket picture, drawn on demand by /api/card/og and stored (see that route).
  // The version changes with each count and with a new "Played" stamp, so each URL can be cached long.
  const played = await playedStamps(d.address, 1500);
  const image = `${SITE_URL}/api/card/og/${d.address}.jpg?v=${encodeURIComponent(ticketOgVersion(d.index.data.asOf, played.byToken.get(token.address.toLowerCase()) ?? null))}`;
  return {
    title,
    description,
    robots,
    openGraph: { title, description, url: `/ticket/${d.address}`, images: [{ url: image, width: 1200, height: 630, alt: title }] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}

const ghostWhy = (e: WalletTokenEntry) => (e.kind === 'dust' ? 'holds under $10' : e.kind === 'farmer' ? 'only received from a giveaway' : 'a contract, not a person');

export default async function TicketPage({ params }: Params) {
  const { address: raw } = await params;
  const d = await load(raw);

  if (!d.valid) notFound();

  const { address, index, bySymbol, real, ghosts } = d;
  const pageUrl = `${SITE_URL}/ticket/${address}`;
  const openAt = buyOpenAt();
  const isCode = ghosts.length > 0 && ghosts.every((g) => g.kind === 'contract' || g.kind === 'pool');
  // The club to take a seat at: where this wallet is closest to one, else the biggest crowd.
  const near = ghosts.find((g) => g.kind === 'dust' || g.kind === 'farmer');
  const target = (near && bySymbol.get(near.symbol)) || index.data.tokens[0];
  const targetClub = clubName(target.name);
  const top = real[0];
  const topToken = top ? bySymbol.get(top.symbol)! : null;
  const [neighbours, played] = await Promise.all([top && topToken ? getNeighbours(top.symbol, top.rank!) : null, real.length ? playedStamps(address) : null]);

  return (
    <main id="main">
      {real.length > 0 && topToken ? (
        <>
          <section className="wrap page-head">
            <h1>{real.length === 1 ? 'One matchday ticket' : `${real.length} matchday tickets`} for <span className="num addr">{shortAddr(address)}</span></h1>
            <p className="lede">
              This wallet is a real fan at {real.length === 1 ? clubName(topToken.name) : `${real.length} clubs`}. Each ticket shows its seat and the thing it does better than most of the crowd.
            </p>
            <p className="asof">Counted {fmtDate(index.data.asOf, true)}, and again {COUNT_EVERY}.</p>
          </section>
          <section className="wrap tickets" aria-label="Tickets">
            {real.map((e, i) => {
              const token = bySymbol.get(e.symbol)!;
              return (
                <div key={e.symbol} className="ticket-block">
                  <div className="ticket-stage">
                    <Ticket address={address} entry={e} token={token} asOf={index.data.asOf} headingLevel={2} printIn={i === 0} stamp={played?.byToken.get(token.address.toLowerCase()) ?? null} badge={played?.badge} />
                  </div>
                  <div className="ticket-actions">
                    <ShareBar address={address} symbol={e.symbol} club={clubName(token.name)} line={statSentence(e.bestStat)} pageUrl={pageUrl} />
                    <Link className="btn" href={groundPath(e.symbol)}>See it in the ground</Link>
                    {i === 0 && <Link className="btn" href={`/statement/${address}`} prefetch={false}>Statement</Link>}
                  </div>
                  {i === 0 && real.length > 1 && <p className="tickets-more">More tickets for this wallet</p>}
                </div>
              );
            })}
          </section>

          <section className="band">
            <div className="wrap">
              <div className="section-head">
                <h2>Do more with this seat</h2>
                <p>A seat is the start. Clubs turn it into a weekly habit with the people you already talk to.</p>
              </div>
              <ul className="next-steps">
                <li>
                  <h3>Support {clubName(topToken.name)}</h3>
                  <p>Every stock has a public club. Take a free seat on its Bench and count toward its turnout in the Supporters table.</p>
                  <Link className="btn btn-accent" href={`/club/stock-${topToken.symbol.toLowerCase()}`} prefetch={false}>Support {clubName(topToken.name)}</Link>
                </li>
                <li>
                  <h3>Found a club with this seat</h3>
                  <p>Name a club, get an invite link for the group chat. Everyone buys from their own wallet and the score is kept for you.</p>
                  <Link className="btn" href="/clubs#start">Found a club</Link>
                </li>
                <li>
                  <h3>Get the “Played” stamp</h3>
                  <p>Buy through Tropa Club in a gameweek and this ticket, and its share picture, are stamped “Played GW0”, with your payday streak under it. {RULE_LINE}</p>
                  <BuyCta token={topToken.address} symbol={topToken.symbol} openAt={openAt} standalone compact label={`Buy $10 more of ${topToken.symbol}`} />
                </li>
              </ul>
            </div>
          </section>

          {neighbours && neighbours.length > 0 && top && (
            <section className="wrap section-tight">
              <h2 className="h3">Neighbouring seats at {clubName(topToken.name)}</h2>
              <p className="muted">The fans sitting either side of real fan {fmtInt(top.rank!)}. Seats go by time held, never by size.</p>
              <ul className="ghost-list neighbours">
                {neighbours.map((n) => (
                  <li key={n.address}>
                    <Pennant kit={kitFor(topToken.symbol)} width={18} />
                    <Link href={`/ticket/${n.address}`} prefetch={false} className="num">{shortAddr(n.address)}</Link>
                    <span>Real fan {fmtInt(n.rank)}, {n.rank < top.rank! ? 'has held longer' : 'arrived after'}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      ) : isCode ? (
        <section className="wrap page-head empty">
          <div className="gate-shut" aria-hidden="true">
            {Array.from({ length: 28 }, (_, i) => <i key={i} />)}
          </div>
          <h1>No seat for <span className="num addr">{shortAddr(address)}</span></h1>
          <p className="lede">This address is a contract, such as a pool, vault or router. It holds stock tokens, but it is code, not a person, so its seat is a ghost seat.</p>
          <p className="closing-links"><Link className="btn" href={groundPath(ghosts[0].symbol)}>See the ground</Link><Link href="/attendance">The Attendance</Link></p>
        </section>
      ) : (
        <section className="wrap page-head convert">
          <div className="convert-text">
            <p className="crumbs">No seat yet for <span className="num addr">{shortAddr(address)}</span></p>
            <h1>Take a seat at {targetClub} for $10</h1>
            <p className="convert-seat">About seat <span className="num">{fmtInt(target.realFans + 1)}</span> at the next count. Seats are recounted {COUNT_EVERY} and ranked by time held, so the newest fan starts at the back and moves forward by holding.</p>
            <p className="lede">
              {near
                ? near.kind === 'dust'
                  ? `This wallet already holds ${target.symbol}, just under the $10 line. Top it up and the next count gives it a seat.`
                  : `This wallet was sent ${target.symbol} in a giveaway but has never bought. One buy of its own makes it a real fan.`
                : `This wallet holds no stock tokens on Base yet. ${fmtInt(target.realFans)} real fans are in the ground at ${targetClub}. The next seat is yours.`}
            </p>
            <BuyCta token={target.address} symbol={target.symbol} openAt={openAt} standalone />
            <p className="muted small">Seats are handed out at each count, {COUNT_EVERY}. {target.symbol} is a stock token that tracks the share price; it is not the share. Not advice.</p>
          </div>
          <div className="convert-ticket">
            <Ticket address={address} entry={{ symbol: target.symbol, usd: 10, kind: 'real', rank: target.realFans + 1, of: target.realFans + 1, bestStat: null }} token={target} headingLevel={2} preview />
            <p className="caption">A preview. The real ticket, with its exact seat, prints once the wallet holds $10 of {target.symbol} at a count.</p>
          </div>
        </section>
      )}

      {real.length === 0 && !isCode && (
        <section className="band">
          <div className="wrap split">
            <div className="split-text">
              <h2>What a seat needs</h2>
              <ul className="ticks">
                <li>$10 or more of one stock token, held in a wallet a person controls.</li>
                <li>At least one purchase. Tokens that were only sent by a giveaway do not count.</li>
                <li>A count. Seats are handed out again {COUNT_EVERY}.</li>
              </ul>
            </div>
            <div className="split-text">
              <h2>Take it with a club</h2>
              <p>Tropa Club is a free investing club for your group chat, each buying from their own wallet, with the score kept for you. {RULE_LINE}</p>
              <p className="closing-links"><Link className="btn" href="/clubs#start">Found a club</Link><Link href="/clubs">How clubs work</Link></p>
            </div>
          </div>
        </section>
      )}

      {(ghosts.length > 0 || real.length > 1) && (
        <section className="wrap section-tight">
          <h2 className="h3">{real.length > 0 ? 'Every ground this wallet is in' : 'Ghost seats'}</h2>
          <p className="muted">{real.length > 0 ? 'Real-fan seats first, then tickets that do not count as a real fan.' : 'Tickets this wallet holds that do not count as a real fan.'}</p>
          <ul className="ghost-list">
            {[...real, ...ghosts].map((e) => {
              const token = bySymbol.get(e.symbol)!;
              return (
                <li key={e.symbol}>
                  <Pennant kit={kitFor(e.symbol)} width={18} />
                  <Link href={groundPath(e.symbol)} prefetch={false}>{clubName(token.name)}</Link>
                  <span>{e.rank != null ? `Real fan ${fmtInt(e.rank)} of ${fmtInt(e.of || token.realFans)}` : `${KIND_LABEL[e.kind] ?? 'Ghost seat'}: ${ghostWhy(e)}`}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className={real.length === 0 && !isCode ? 'wrap section' : 'band'}>
        <div className={real.length === 0 && !isCode ? 'split' : 'wrap split'}>
          <div className="split-text">
            <h2>{real.length > 0 ? 'Not your wallet? Paste yours' : 'Try another wallet'}</h2>
            <p>Any address on Base works. Nothing to connect, nothing to sign.</p>
            <SeatSearchBox label="Wallet address or name" button="Find seat" />
          </div>
          <div className="split-text">
            <h2>How to read a ticket</h2>
            <dl className="defs">
              <div><dt>Block, row, seat</dt><dd>Where the wallet sits in that club&rsquo;s ground. Lower rows near halfway go to the longest holders.</dd></div>
              <div><dt>Real fan number</dt><dd>Rank among the club&rsquo;s real fans by unbroken days held, then by first buy. Never by size.</dd></div>
              <div><dt>The line in bold</dt><dd>The wallet&rsquo;s best true stat: hold time, arrival, entry price against the median fan, or weekly streak.</dd></div>
              <div><dt>Barcode</dt><dd>Drawn from the bytes of the address. It is a pattern, not a code anyone can scan for value.</dd></div>
            </dl>
          </div>
        </div>
      </section>

      <section className="wrap section-tight">
        <p className="muted small fine">
          {notAffiliated((real.length ? real : ghosts.length ? ghosts : [{ symbol: target.symbol }]).slice(0, 6).map((e) => bySymbol.get(e.symbol)?.name ?? ''))}
        </p>
      </section>
    </main>
  );
}
