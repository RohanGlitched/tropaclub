import type { Metadata } from 'next';
import Link from 'next/link';
import Ticket from '@/components/ds/Ticket';
import ShareBar from '@/components/ShareBar';
import SeatSearchBox from '@/components/SeatSearchBox';
import { Pennant } from '@/components/ds/Pennant';
import { getIndex, getWallet } from '@/lib/server/data';
import { cardName, storedCardUrl } from '@/lib/server/cardstore';
import { clubName, groundPath, kitFor } from '@/lib/clubs';
import { fmtDate, fmtInt, isAddress, shortAddr } from '@/lib/format';
import { KIND_LABEL, statSentence } from '@/lib/ticket';
import { OPENS, SITE_URL } from '@/lib/site';

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
  const ghosts = held.filter((e) => e.rank == null);
  return { address, valid: true as const, index, wallet, bySymbol, real, ghosts };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { address: raw } = await params;
  const d = await load(raw);
  const robots = { index: false, follow: true };
  if (!d.valid) return { title: 'Not a wallet address', robots };
  const top = d.real[0];
  if (!top) return { title: `No seat yet for ${shortAddr(d.address)}`, description: 'This wallet has no real-fan seat in any ground yet. See what a seat needs.', robots };
  const token = d.bySymbol.get(top.symbol)!;
  const title = `Matchday ticket: ${clubName(token.name)}, real fan ${fmtInt(top.rank!)} of ${fmtInt(top.of || token.realFans)}`;
  const description = `${statSentence(top.bestStat)}. ${shortAddr(d.address)} has ${d.real.length === 1 ? 'a seat' : `${d.real.length} seats`} in The Ground. Find yours.`;
  // A stored picture if one was made by a Share tap; otherwise the static default. Never rendered here.
  const stored = await storedCardUrl(cardName(d.address, top.symbol, 'landscape'));
  const image = stored ?? '/og-default.png';
  return {
    title,
    description,
    robots,
    openGraph: { title, description, url: `/ticket/${d.address}`, images: [{ url: image, width: 1200, height: 630, alt: title }] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}

export default async function TicketPage({ params }: Params) {
  const { address: raw } = await params;
  const d = await load(raw);

  if (!d.valid) {
    return (
      <>
        <main id="main">
          <section className="wrap page-head empty">
            <h1>That is not a wallet address</h1>
            <p className="lede">A wallet address starts with 0x and has 42 characters. Paste it again, or use a name such as yourname.base.eth.</p>
            <SeatSearchBox />
          </section>
        </main>
      </>
    );
  }

  const { address, index, bySymbol, real, ghosts } = d;
  const top = index.data.tokens[0];
  const pageUrl = `${SITE_URL}/ticket/${address}`;

  return (
    <>
      <main id="main">
        {real.length > 0 ? (
          <>
            <section className="wrap page-head">
              <h1>{real.length === 1 ? 'One matchday ticket' : `${real.length} matchday tickets`} for <span className="num addr">{shortAddr(address)}</span></h1>
              <p className="lede">
                This wallet is a real fan at {real.length === 1 ? clubName(bySymbol.get(real[0].symbol)!.name) : `${real.length} clubs`}. Each ticket shows its seat and the thing it does better than most of the crowd.
              </p>
              <p className="asof">Counted {fmtDate(index.data.asOf, true)}. Past performance · not advice.</p>
            </section>
            <section className="wrap tickets" aria-label="Tickets">
              {real.map((e, i) => {
                const token = bySymbol.get(e.symbol)!;
                return (
                  <div key={e.symbol} className="ticket-block">
                    <div className="ticket-stage">
                      <Ticket address={address} entry={e} token={token} asOf={index.data.asOf} headingLevel={2} printIn={i === 0} />
                    </div>
                    <div className="ticket-actions">
                      <ShareBar address={address} symbol={e.symbol} club={clubName(token.name)} line={statSentence(e.bestStat)} pageUrl={pageUrl} />
                      <Link className="btn" href={groundPath(e.symbol)}>See it in the ground</Link>
                    </div>
                    {i === 0 && real.length > 1 && <p className="tickets-more">More tickets for this wallet</p>}
                  </div>
                );
              })}
            </section>
          </>
        ) : (
          <section className="wrap page-head empty">
            <div className="gate-shut" aria-hidden="true">
              {Array.from({ length: 28 }, (_, i) => <i key={i} />)}
            </div>
            <h1>No seat yet for <span className="num addr">{shortAddr(address)}</span></h1>
            <p className="lede">
              {ghosts.length > 0
                ? ghosts.every((g) => g.kind === 'contract' || g.kind === 'pool')
                  ? 'This address is a contract, such as a pool, vault or router. It holds stock tokens, but it is code, not a person, so its seat is a ghost seat.'
                  : ghosts.every((g) => g.kind === 'farmer')
                    ? `This wallet holds ${ghosts.length === 1 ? 'a stock token' : 'stock tokens'}, but only ever received them from a giveaway and never bought, so its seat is a ghost seat.`
                    : ghosts.every((g) => g.kind === 'dust')
                      ? `This wallet holds ${ghosts.length === 1 ? 'a stock token' : 'stock tokens'}, but under the $10 line, so its seat is a ghost seat.`
                      : 'This wallet holds stock tokens, but under the $10 line or only from a giveaway, so its seats are ghost seats.'
                : 'This wallet holds no stock tokens on Base, so it has no seat in any ground.'}{' '}
              {fmtInt(top.realFans)} real fans are in the ground at {clubName(top.name)} today.
            </p>
            <div className="empty-next">
              <div>
                <h2>What a seat needs</h2>
                <ul className="ticks">
                  <li>$10 or more of one stock token, held in a wallet a person controls.</li>
                  <li>At least one purchase. Tokens that were only sent by a giveaway do not count.</li>
                  <li>A count. Seats are handed out again at each one.</li>
                </ul>
              </div>
              <div className="clubs-only">
                <h2>Take a seat with a club</h2>
                <p>Tropa Club is a free investing club for your group chat: $10 a week each, from your own wallets, with the score kept for you. Buying opens {OPENS}. Found a club or join a pick-up club today.</p>
                <p><Link className="btn" href="/clubs">Clubs</Link></p>
              </div>
            </div>
            <p className="muted small">Stock tokens track the share price. Nothing here is advice to buy one.</p>
          </section>
        )}

        {ghosts.length > 0 && (
          <section className="wrap section-tight">
            <h2 className="h3">Ghost seats</h2>
            <p className="muted">Tickets this wallet holds that do not count as a real fan.</p>
            <ul className="ghost-list">
              {ghosts.map((e) => {
                const token = bySymbol.get(e.symbol)!;
                return (
                  <li key={e.symbol}>
                    <Pennant kit={kitFor(e.symbol)} width={18} />
                    <Link href={groundPath(e.symbol)}>{clubName(token.name)}</Link>
                    <span>{KIND_LABEL[e.kind] ?? 'Ghost seat'}: {e.kind === 'dust' ? 'holds under $10' : e.kind === 'farmer' ? 'only received from a giveaway' : 'a contract, not a person'}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="band">
          <div className="wrap split">
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
      </main>
    </>
  );
}
