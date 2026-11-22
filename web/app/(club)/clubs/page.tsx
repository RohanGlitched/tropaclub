import type { Metadata } from 'next';
import Link from 'next/link';
import { InviteCodeForm, PickupButton, StartClub } from '@/components/club/Actions';
import { Crest, Pennant } from '@/components/ds/Pennant';
import ClubPreview from '@/components/ClubPreview';
import StockClubList from '@/components/club/StockClubList';
import OpensAt from '@/components/OpensAt';
import Term from '@/components/nav/Term';
import { Crumbs, NextStrip } from '@/components/nav/Wayfinding';
import PageSections from '@/components/nav/PageSections';
import Anchor from '@/components/nav/Anchor';
import { crestOf, ensureStockClubs, tryClubs } from '@/lib/server/clubs';
import { getIndex, getStats } from '@/lib/server/data';
import PreSeason from '@/components/PreSeason';
import LookBeforeConnect from '@/components/LookBeforeConnect';
import { SeasonBanner } from '@/components/season/CapsCopy';
import { sessionWallet } from '@/lib/server/session';
import { fmtInt } from '@/lib/format';
import { DOCS_URL, FIXTURE_STEPS, HABIT_USD, LAUNCH_AT, PAUSED_MESSAGE, PLAY_USD, REGION_LINE, RULE_LINE, SITE_URL, STREAK_SHORT, buyState, openClubName } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Clubs: buy stock tokens with your group chat',
  description: 'Start a free club for your group chat, join one with an invite, get matched into a pick-up club, or join a stock token’s open club. Everyone buys about $10 a week from their own wallet. No shared pot, no fee.',
};

export default async function ClubsPage() {
  const [wallet, { data: index }, { data: stats }] = await Promise.all([sessionWallet(), getIndex(), getStats()]);
  const data = await tryClubs(async (svc) => {
    await ensureStockClubs(svc);
    const [stock, priv, pick, mine] = await Promise.all([svc.listClubs('stock'), svc.listClubs('private'), svc.listClubs('pickup'), wallet ? svc.walletClubs(wallet) : Promise.resolve([])]);
    return { stock, priv, pick, mine, now: svc.ctx.now() };
  });
  const state = buyState();
  const preLaunch = state === 'before';
  const openAt = LAUNCH_AT;
  const stock = new Map((data?.stock ?? []).map((c) => [c.stockSymbol, c]));
  const stockRows = index.tokens.map((t) => ({ symbol: t.symbol, name: t.name, realFans: t.realFans, supporters: stock.get(t.symbol)?.memberCount ?? 0, playing: stock.get(t.symbol)?.playingCount ?? 0 }));
  const started = data ? data.priv.length + data.pick.length : 0;
  const stockName = (symbol: string | null | undefined, fallback: string) => {
    const t = index.tokens.find((x) => x.symbol === symbol);
    return t ? openClubName(t.name, t.symbol) : fallback;
  };

  return (
    <main id="main">
      <PageSections
        sections={[
          { id: 'kinds', label: 'Three kinds' },
          ...(data && data.mine.length > 0 ? [{ id: 'yours', label: 'Your clubs' }] : []),
          { id: 'start', label: 'Start a club' },
          { id: 'join', label: 'Join' },
          { id: 'supporters', label: 'Open clubs' },
          { id: 'week', label: 'Each week' },
          { id: 'sample', label: 'Sample card' },
          { id: 'how-scored', label: 'How it is scored' },
        ]}
      />
      <section className="wrap page-head">
        <Crumbs trail={[{ label: 'Clubs' }]} />
        <h1>Clubs: buy stock tokens with your group chat</h1>
        <p className="lede">
          A <Term id="club">club</Term> is you and your friends each buying about $10 of stock tokens a week, from your own wallets. Tropa Club shows who bought each week, keeps your streaks and keeps a cost-basis record. There&rsquo;s no shared pot and no fee.
        </p>
        <p className="hero-cta"><a className="btn btn-accent" href="#start">Start a club</a></p>
        <p className="muted small">
          Free to start. No buy needed to join. {preLaunch ? <>Buying opens <OpensAt at={openAt} />. </> : state === 'paused' ? `${PAUSED_MESSAGE} ` : ''}{REGION_LINE}
        </p>
        {data && started > 0 && <p className="asof">{fmtInt(started)} {started === 1 ? 'club' : 'clubs'} started so far.</p>}
        {data && started === 0 && (preLaunch ? <PreSeason openAt={openAt} holders={stats.realWallets} /> : <p className="asof">No clubs yet. Yours could be the first.</p>)}
        <SeasonBanner className="s1-banner-clubs clubs-only" />
      </section>

      <section className="wrap section-tight" id="kinds" aria-label="Three kinds of club">
        <ul className="limits">
          <li><h3>Private club</h3><p>You start it and invite your group chat with a link. Up to 50 members.</p></li>
          <li><h3>Pick-up club</h3><p>No group chat? We match you with up to four others from your region. A <Term id="pickup-club">pick-up club</Term> starts once three can be put together.</p></li>
          <li><h3>Open club</h3><p>Every stock token has one, like the {openClubName(index.tokens[0].name, index.tokens[0].symbol)}. Anyone can join. Only buys of that token count.</p></li>
        </ul>
      </section>

      {!data && (
        <section className="wrap section-tight">
          <p className="notice">The clubs list is not answering just now, so clubs cannot be listed or joined. Nothing is lost. Try again in a minute.</p>
        </section>
      )}

      {data && data.mine.length > 0 && (
        <section className="wrap section-tight" id="yours" aria-label="Your clubs">
          <h2 className="h3">Your clubs<Anchor id="yours" label="Your clubs" /></h2>
          <div className="club-grid">
            {data.mine.map(({ club, member }) => (
              <Link key={club.id} href={`/club/${club.id}`} className="club-card">
                <Pennant kit={crestOf(club)} width={30} />
                <span>
                  <b>{club.kind === 'stock' ? stockName(club.stockSymbol, club.name) : club.name}</b>
                  <small>{member.seat === 'playing' ? 'You bought this week' : 'On the Bench: not bought yet this week'}, {fmtInt(club.memberCount)} {club.memberCount === 1 ? 'member' : 'members'}</small>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="band" id="start">
        <div className="wrap split">
          <div className="split-text">
            <h2>Start a club<Anchor id="start" label="Start a club" /></h2>
            <p>Name it and we&rsquo;ll draw a crest for it. You get an invite link for the group chat. Anyone who opens the link can join for free. They don&rsquo;t need to buy.</p>
            <ul className="ticks">
              <li>Up to 50 members. One wallet can start up to 5 clubs and be in up to 12.</li>
              <li>Joining is free and needs no buy. About ${HABIT_USD} a week is the habit. Buying ${PLAY_USD} or more through Tropa Club in a <Term id="gameweek">gameweek</Term> counts as played.</li>
              <li>From Mon Nov 30, clubs of 3 or more are paired each week with a club of a similar size. Bragging rights only: <a href="#how-scored">how a club is scored</a>.</li>
            </ul>
          </div>
          <div className="start-col">
            <StartClub />
            <LookBeforeConnect site={SITE_URL} />
          </div>
        </div>
      </section>

      <section className="wrap section" id="join">
        <div className="split">
          <div className="split-text">
            <h2>Join with an invite<Anchor id="join" label="Join with an invite" /></h2>
            <p>Private clubs are joined with a link from someone inside. Paste it here, or just open it.</p>
            <InviteCodeForm />
          </div>
          <div className="split-text">
            <h2>No group chat? Join a club with strangers</h2>
            <p>Ask to be matched and we&rsquo;ll put you in a pick-up club with up to 4 other people from your region. It starts once it has three. It gets a region name and a crest, and it never shows where any member is from.</p>
            <PickupButton />
            <p className="muted small">Connecting a wallet signs you in; it doesn&rsquo;t spend anything. Your country is used once to match you and is not stored with your wallet. Wallets with the same first USDC or WETH sender are never matched together.</p>
          </div>
        </div>
      </section>

      <section className="band" id="supporters">
        <div className="wrap">
          <div className="section-head">
            <h2>Or join a stock token&rsquo;s open club<Anchor id="supporters" label="Open clubs" /></h2>
            <p>Each of the {index.tokens.length} stock tokens has an <Term id="stock-club">open club</Term> anyone can join for free, like the {openClubName(index.tokens[0].name, index.tokens[0].symbol)}. Its members are people who joined here, so it starts at 0 members even when the token has thousands of real holders. Open clubs are ranked on how many members buy each week and keep a streak, never on returns, and they are not paired with other clubs. The biggest tokens are listed first.</p>
          </div>
          {preLaunch && started > 0 && stockRows.every((r) => r.supporters === 0) && <PreSeason openAt={openAt} holders={stats.realWallets} />}
          <StockClubList rows={stockRows} />
          <p className="after-table"><Link className="btn" href="/league#supporters">See open club rankings</Link></p>
        </div>
      </section>

      <section className="wrap section" id="week">
        <div className="section-head">
          <h2>What happens each week<Anchor id="week" label="What happens each week" /></h2>
          <p>A gameweek runs from the first US stock market session of the week to the last close. Week 0 starts with buying, <OpensAt at={openAt} />, and is a practice week.</p>
        </div>
        <ul className="limits">
          <li><h3>Buy, and you&rsquo;ve played</h3><p>Buy ${PLAY_USD} or more of any stock token through Tropa Club before the US stock market closes on the last trading day of the week. That counts as played.</p></li>
          <li><h3>The Bench is who hasn&rsquo;t bought yet</h3><p>Members who haven&rsquo;t bought this week show on the <Term id="bench">Bench</Term>. A teammate who has bought can send them a one-tap <Term id="nudge">nudge</Term>.</p></li>
          <li><h3>The weekly card</h3><p>Your club&rsquo;s <Term id="matchday">Matchday card</Term> shows who bought, who hasn&rsquo;t yet, and turnout, updated after each US trading day.</p></li>
        </ul>
      </section>

      <section className="band" id="sample">
        <div className="wrap">
          <div className="section-head">
            <h2>A sample weekly card<Anchor id="sample" label="A sample weekly card" /></h2>
            <p>Made-up names. Four of five have bought this week. Send a nudge to the one on the Bench.</p>
          </div>
          <ClubPreview />
        </div>
      </section>

      <section className="wrap section" id="how-scored">
        <div className="section-head">
          <h2>How a club is scored<Anchor id="how-scored" label="How a club is scored" /></h2>
        </div>
        <ul className="limits">
          <li><h3>You play by buying</h3><p>{RULE_LINE} Any stock token counts, bought through Tropa Club before the US stock market closes on the last trading day of the week.</p></li>
          <li><h3>Turnout comes first</h3><p>If 80% or more of members buy that week, the club gets a bonus point in the weekly rankings. That is what nudges are for.</p></li>
          <li>
            <h3>Weekly pairings are bragging rights</h3>
            <p>{FIXTURE_STEPS.lead}</p>
            <ol className="tiebreak">
              {FIXTURE_STEPS.steps.map((s) => <li key={s}>{s}</li>)}
            </ol>
            <p>{FIXTURE_STEPS.after} No prize ever depends on it.</p>
          </li>
          <li><h3>Payday streak</h3><p>{STREAK_SHORT} A habit badge: it never changes a score.</p></li>
          <li><h3>Size never counts</h3><p>Scores use percentages and head counts. Ten dollars counts the same as ten thousand.</p></li>
          <li><h3>Season 1 Caps</h3><p>Playing, holding and friends who count earn Caps toward the planned $TROPA airdrop, and founding a club where 2 or more members play in the same gameweek adds a founder Cap. <Link href="/season#earn">How to earn</Link></p></li>
          <li><h3>Your money stays yours</h3><p>Each buy goes from your wallet to a public exchange. There is no club pot and nothing to withdraw.</p></li>
          <li><h3>Where buying is offered</h3><p>{REGION_LINE} Club pages can still be viewed everywhere.</p></li>
        </ul>
        <p className="after-table">
          <Link className="btn" href="/league">League</Link>{' '}
          <a className="btn" href={`${DOCS_URL}/scoring-and-seasons`} rel="noopener">Full rules</a>
        </p>
      </section>

      <section className="closing">
        <div className="wrap closing-in">
          <div className="closing-crests" aria-hidden="true">
            {(data?.priv ?? []).slice(0, 6).map((c) => <Crest key={c.id} recipe={crestOf(c)} width={34} />)}
          </div>
          <h2>Bring your group chat</h2>
          <p>Start a club in a minute. It is free, and anyone you invite can join without buying.</p>
          <p className="closing-links"><Link className="btn btn-accent" href="#start">Start a club</Link><Link href="/about">How it works</Link></p>
        </div>
      </section>

      <NextStrip
        items={[
          { title: 'League', sub: 'Club scores, open clubs, Season 1 points (Caps) and Scouts', href: '/league' },
          { title: 'Your ticket', sub: 'Your rank in every ground you are in', mine: 'ticket' },
        ]}
      />
    </main>
  );
}
