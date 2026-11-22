import type { Metadata } from 'next';
import Link from 'next/link';
import { ClubLeagueTable, PreseasonTable, SupportersTable } from '@/components/club/Tables';
import StockClubList from '@/components/club/StockClubList';
import Term from '@/components/nav/Term';
import { Crumbs, NextStrip } from '@/components/nav/Wayfinding';
import ClubPreview from '@/components/ClubPreview';
import { Pennant } from '@/components/ds/Pennant';
import { crestOf, ensureStockClubs, tryClubs } from '@/lib/server/clubs';
import { getIndex, getStats } from '@/lib/server/data';
import PreSeason from '@/components/PreSeason';
import { fmtInt } from '@/lib/format';
import { isListedClub, publicName } from '@tropaclub/clubs';
import { BOARD_PAGE, BoardPager, CapsBoard, ScoutsBoard } from '@/components/club/Boards';
import { boardNames, capsBoard, scoutsBoard } from '@/lib/server/honours';
import { CAPS_COPY, CAPS_RULES, DOCS_URL, FIXTURE_RULE, OPENS, PLAY_USD, REAL_FAN_USD, RULE_LINE, SCOUT_COPY, SCOUT_COUNTS, SCOUT_RULES, LAUNCH_AT, buyState, openClubName } from '@/lib/site';

type Tab = 'tables' | 'caps' | 'scouts';
type Search = { searchParams: Promise<{ tab?: string | string[]; page?: string | string[] }> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const TABS: { id: Tab; label: string; href: string }[] = [
  { id: 'tables', label: 'Rankings', href: '/league' },
  { id: 'caps', label: 'Points (Caps)', href: '/league?tab=caps' },
  { id: 'scouts', label: 'Top referrers (Scouts)', href: '/league?tab=scouts' },
];

// Each tab has its own title.
export async function generateMetadata({ searchParams }: Search): Promise<Metadata> {
  const t = one((await searchParams).tab);
  if (t === 'caps') return { title: 'Caps: points for buying and holding', description: 'Caps are scoreboard points for buying each week and still holding a week later. Not money, not a token.' };
  if (t === 'scouts') return { title: 'Top referrers (Scouts)', description: 'Members whose referred friends bought through Tropa Club and still held at day 7. No prizes, no cash.' };
  return { title: 'Club rankings: friend clubs and open clubs', description: 'Friend clubs on Tropa Club are paired each week and collect points, with a bonus for turnout. Open clubs are ranked only on how many members buy. No prize depends on returns.' };
}

export default async function LeaguePage({ searchParams }: Search) {
  const sp = await searchParams;
  const tab: Tab = one(sp.tab) === 'caps' ? 'caps' : one(sp.tab) === 'scouts' ? 'scouts' : 'tables';
  const page = Math.max(1, Math.min(10_000, Math.floor(Number(one(sp.page)) || 1)));
  const tabs = (
    <nav className="board-tabs" aria-label="League pages">
      {TABS.map((t) => (
        <Link key={t.id} href={t.href} prefetch={false} aria-current={t.id === tab ? 'page' : undefined}>{t.label}</Link>
      ))}
    </nav>
  );
  if (tab !== 'tables') return <BoardPage tab={tab} page={page} tabs={tabs} />;

  const [{ data: index }, { data: stats }, data] = await Promise.all([
    getIndex(),
    getStats(),
    tryClubs(async (svc) => {
      await ensureStockClubs(svc);
      const [league, pre, sup, clubs] = await Promise.all([svc.getLeagueTable(), svc.getPreseasonTable(), svc.getSupportersTable(), svc.listClubs()]);
      return { league, pre, sup, clubs };
    }),
  ]);
  const byId = new Map((data?.clubs ?? []).map((c) => [c.id, c]));
  const crest = (id: string, seed: string) => crestOf(byId.get(id) ?? { crestSeed: seed });
  // Names are public here: cleaned and capped, and a hidden club, or one whose name is not allowed, is never named.
  const shown = (id: string, name: string) => {
    const c = byId.get(id);
    return c && c.kind !== 'stock' && (c.hidden === true || !isListedClub({ ...c, memberCount: Math.max(c.memberCount, 2) })) ? 'Name withheld' : publicName(name);
  };
  const league = (data?.league.rows ?? []).map((r) => ({ ...r, name: shown(r.clubId, r.name), crest: crest(r.clubId, r.crestSeed), note: r.form.length ? `Form ${r.form.slice(-5).join(' ')}` : null }));
  const pre = (data?.pre ?? []).map((r) => ({ ...r, name: shown(r.clubId, r.name), crest: crest(r.clubId, r.crestSeed), note: null }));
  const tokenOf = (s: string | null | undefined) => index.tokens.find((t) => t.symbol === s);
  const sup = (data?.sup.rows ?? []).filter((r) => r.members > 0).map((r) => {
    const t = tokenOf(r.stockSymbol);
    return { ...r, name: t ? openClubName(t.name, t.symbol) : r.name, crest: crest(r.clubId, r.crestSeed), note: r.stockSymbol };
  });
  const season = league.length > 0;
  const started = (data?.clubs ?? []).filter((c) => c.kind !== 'stock');
  // A club is listed once it has a second member or a member has made a qualifying buy.
  const founding = started.filter((c) => isListedClub(c)).sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  const stock = new Map((data?.clubs ?? []).filter((c) => c.kind === 'stock').map((c) => [c.stockSymbol, c]));
  const stockRows = index.tokens.map((t) => ({ symbol: t.symbol, name: t.name, realFans: t.realFans, supporters: stock.get(t.symbol)?.memberCount ?? 0, playing: stock.get(t.symbol)?.playingCount ?? 0 }));
  const preLaunch = buyState() === 'before';
  const openAt = LAUNCH_AT;
  // the pre-season line is shown once: under "First clubs" when that is empty, else over the open clubs
  const preseasonTop = preLaunch && !season && !pre.length && !founding.length;

  return (
    <main id="main">
      <section className="wrap page-head">
        <Crumbs trail={[{ label: 'League' }]} />
        <p className="hero-pitch">The league</p>
        <h1>Club rankings</h1>
        <p className="lede">
          Friend clubs (private and <Term id="pickup-club">pick-up clubs</Term>) are paired each week with a club of a similar size and collect points, plus a bonus point whenever 80% or more of members buy. <Term id="stock-club">Open clubs</Term> are ranked only on how many members buy. Nothing here depends on how much money anyone holds: every number is a head count or a percentage.
        </p>
        <p className="hero-cta"><Link className="btn btn-accent" href="/clubs#start">Start a club</Link></p>
        <p className="asof">
          {season
            ? `Through ${data?.league.throughGw?.replace('GW', 'gameweek ') ?? 'the last gameweek'}.`
            : pre.length
              ? 'Week 0 is a practice week: no pairings yet, so clubs are listed by turnout.'
              : `Week 0 starts ${OPENS}. It’s a practice week. Clubs start being paired from Mon Nov 30.`}
        </p>
      </section>

      <section className="wrap section-tight" aria-labelledby="week-h">
        <h2 className="h3" id="week-h">How a week works</h2>
        <ul className="limits">
          <li><h3>One <Term id="gameweek">gameweek</Term></h3><p>From the first US stock market session of the week (usually Monday) to the last close (usually Friday).</p></li>
          <li><h3>Buy ${PLAY_USD}, and you&rsquo;ve played</h3><p>{RULE_LINE} Members who haven&rsquo;t bought yet are on the <Term id="bench">Bench</Term>.</p></li>
          <li><h3>Paired from Mon Nov 30</h3><p>Clubs with 3 or more members are paired with a club of a similar size each week (a <Term id="fixture">fixture</Term>). Bragging rights only.</p></li>
        </ul>
      </section>

      <div className="wrap">{tabs}</div>

      {!data ? (
        <section className="wrap section-tight"><p className="notice">The tables could not be loaded just now. Try again in a minute.</p></section>
      ) : season || pre.length ? (
        <section className="wrap section-tight" id="league" aria-label={season ? 'Friend club rankings' : 'Practice week rankings'}>
          <h2 className="h3 table-title">{season ? 'Friend club rankings' : 'Practice week rankings, by turnout'}</h2>
          {season ? <ClubLeagueTable rows={league} /> : <PreseasonTable rows={pre} />}
        </section>
      ) : (
        <section className="wrap section-tight" id="league" aria-label="First clubs">
          <div className="split">
            <div className="split-text">
              <h2 className="h3 table-title">First clubs</h2>
              {founding.length ? (
                <>
                  <p className="muted">Clubs started before the first gameweek, in the order they were started. A club is listed once a second member joins or a member buys, and needs three members to be ranked.</p>
                  <ol className="founding">
                    {founding.slice(0, 30).map((c, i) => (
                      <li key={c.id}>
                        <span className="founding-no num">No. {i + 1}</span>
                        <Pennant kit={crestOf(c)} width={20} />
                        <Link href={`/club/${c.id}`} prefetch={false}>{publicName(c.name)}</Link>
                        <span className="founding-n">{fmtInt(c.memberCount)} {c.memberCount === 1 ? 'member' : 'members'}{c.memberCount < 3 ? `, ${3 - c.memberCount} more to be ranked` : ''}</span>
                      </li>
                    ))}
                  </ol>
                  {founding.length > 30 && <p className="muted small">And {fmtInt(founding.length - 30)} more.</p>}
                </>
              ) : (
                <>
                  {preseasonTop && <PreSeason openAt={openAt} holders={stats.realWallets} />}
                  <p className="notice">{started.length ? 'No club has a second member yet. A club is listed here once one joins or a member buys.' : 'The first club started is listed here as club No. 1.'}</p>
                </>
              )}
              <p className="after-table"><Link className="btn btn-accent" href="/clubs#start">{started.length ? `Start club No. ${fmtInt(started.length + 1)}` : 'Start the first club'}</Link></p>
            </div>
            <div className="split-text">
              <h2 className="h3 table-title">Sample weekly club card</h2>
              <p className="muted">Made-up names. This <Term id="matchday">Matchday card</Term> is what every club gets once its members start buying.</p>
              <div className="preview-frame"><span className="tag">Sample</span><ClubPreview /></div>
            </div>
          </div>
        </section>
      )}

      {data && (
        <section className="band" id="supporters">
          <div className="wrap">
            <div className="section-head">
              <h2>Open club rankings</h2>
              <p>One open club for every stock token, open to anyone. Ranked on the share of members who bought this gameweek, then on the share on a buying streak. Returns play no part.</p>
            </div>
            {sup.length ? (
              <SupportersTable rows={sup} />
            ) : (
              <>
                {preLaunch && !preseasonTop && <PreSeason openAt={openAt} holders={stats.realWallets} />}
                <p className="muted">{preLaunch ? 'Open clubs are ranked once members start buying. Join one for free now and it appears here.' : 'No open club has a member yet, so there is nothing to rank. Join one for free and it appears here.'} The biggest tokens come first.</p>
                <StockClubList rows={stockRows} first={8} />
              </>
            )}
          </div>
        </section>
      )}

      <section className="wrap section">
        <div className="section-head"><h2>How the rankings work</h2></div>
        <ul className="limits">
          <li><h3>You play by buying</h3><p>{RULE_LINE} Members who haven&rsquo;t bought are on the Bench that week.</p></li>
          <li><h3>Points from the weekly pairing</h3><p>{FIXTURE_RULE}</p></li>
          <li><h3>1 bonus point for turnout</h3><p>Any club where 80% or more of members bought that week gets a bonus point, whatever the pairing shows.</p></li>
          <li><h3>Paired by size</h3><p>Clubs need three members to be paired, and they meet clubs in the same size band.</p></li>
          <li><h3>Turnout counts, not money</h3><p>What decides a pairing is how many of your club played, as a share of members. A $5 buy counts as much as a $500 one, and returns decide nothing.</p></li>
          <li><h3>Bragging rights only</h3><p>No prize, perk or payout ever depends on a return. Open clubs ignore returns altogether.</p></li>
        </ul>
        <p className="after-table"><a className="btn" href={DOCS_URL} rel="noopener">Scoring rules in the docs</a></p>
      </section>

      <section className="closing">
        <div className="wrap closing-in">
          <h2>Put your club in the rankings</h2>
          <p>Three members and one gameweek is all it takes.</p>
          <p className="closing-links"><Link className="btn btn-accent" href="/clubs#start">Start a club</Link><Link href="/stats">Stats</Link></p>
        </div>
      </section>

      <NextStrip
        items={[
          { title: 'Your ticket', sub: 'Your rank in every ground you are in', mine: 'ticket' },
          { title: 'Stats', sub: 'Numbers on Tropa Club’s own use', href: '/stats' },
        ]}
      />
    </main>
  );
}

/** The Caps and Top scouts tabs. Computed per request (the tables are cached for 60 s), top 50 a page. */
async function BoardPage({ tab, page, tabs }: { tab: 'caps' | 'scouts'; page: number; tabs: React.ReactNode }) {
  const caps = tab === 'caps';
  const all = caps ? await capsBoard() : await scoutsBoard();
  const total = all?.length ?? 0;
  const pages = Math.max(1, Math.ceil(total / BOARD_PAGE));
  const at = Math.min(page, pages);
  const slice = (all ?? []).slice((at - 1) * BOARD_PAGE, at * BOARD_PAGE);
  const names = await boardNames(slice.map((r) => r.wallet));
  const start = (at - 1) * BOARD_PAGE;

  return (
    <main id="main">
      <section className="wrap page-head">
        <Crumbs trail={[{ label: 'League', href: '/league' }, { label: caps ? 'Points (Caps)' : 'Top referrers (Scouts)' }]} />
        <h1>{caps ? 'Caps (season points)' : 'Top referrers (Scouts)'}</h1>
        <p className="asof">Cosmetic only: nothing here is money or a token.</p>
        <p className="lede">
          {caps
            ? <>You get <Term id="caps">Caps</Term>, our season points, for buying in a <Term id="gameweek">gameweek</Term> and for still holding a week later. They&rsquo;re points on a scoreboard, never for the size of a buy.</>
            : <>Members whose referred friends bought ${SCOUT_RULES.holdUsd} or more through Tropa Club and still held it on day 7 (<Term id="scout">Scouts</Term>). Ranked on friends who count and still hold, then on friends who count.</>}
        </p>
      </section>
      <section className="wrap section-tight" aria-label={caps ? 'Caps table' : 'Top referrers table'}>
        {tabs}
        {!all ? (
          <p className="notice">The table could not be loaded just now. Try again in a minute.</p>
        ) : !total ? (
          <p className="notice">
            {caps
              ? `No Caps yet. The first are given once week 0 buys are recorded, from ${OPENS}.`
              : 'No referrer has a friend who counts yet. A credit is decided on day 7 after a friend’s first buy.'}
          </p>
        ) : caps ? (
          <CapsBoard rows={(slice as { wallet: string; caps: number; rank: number; firstBuyAt: number | null }[]).map((r) => ({ rank: r.rank, name: names.get(r.wallet)!, caps: r.caps, firstBuyAt: r.firstBuyAt }))} />
        ) : (
          <ScoutsBoard rows={(slice as { wallet: string; credited: number; stillHolding: number; badge: string | null }[]).map((r, i) => ({ rank: start + i + 1, name: names.get(r.wallet)!, stillHolding: r.stillHolding, credited: r.credited, badge: r.badge }))} />
        )}
        <BoardPager tab={tab} page={at} total={total} />
        {caps ? (
          <p className="board-copy">{CAPS_COPY}</p>
        ) : (
          <>
            <p className="board-copy">{SCOUT_COPY}</p>
            <p className="muted">{SCOUT_COUNTS}</p>
          </>
        )}
      </section>

      <section className="band">
        <div className="wrap">
          <div className="section-head"><h2>{caps ? 'How Caps are earned' : 'How referring works'}</h2></div>
          {caps ? (
            <ul className="limits">
              <li><h3>{CAPS_RULES.played} Cap for playing</h3><p>You bought ${PLAY_USD} or more through Tropa Club that gameweek.</p></li>
              <li><h3>{CAPS_RULES.heldD7} Caps for still holding</h3><p>That buy is still in your wallet, ${SCOUT_RULES.holdUsd} or more, 7 days later.</p></li>
              <li><h3>{CAPS_RULES.scout} Caps per friend who counts</h3><p>For each friend you referred whose first buy is still held on day 7, up to {CAPS_RULES.scoutPerGw} a gameweek.</p></li>
              <li><h3>{CAPS_RULES.perGw} Caps at most</h3><p>The most you can earn in a gameweek, whatever happens.</p></li>
              <li><h3>Nothing for noise</h3><p>No Caps for sign-ups, joins, follows, likes or reposts, and none for history before launch.</p></li>
              <li><h3>Ties</h3><p>Equal totals are split by the earlier first buy through Tropa Club.</p></li>
            </ul>
          ) : (
            <ul className="limits">
              <li><h3>Your link</h3><p>Every member gets a personal link (tropaclub.xyz/j/ plus a code). Club invites you send carry it too.</p></li>
              <li><h3>First link counts</h3><p>A new wallet that arrives through a link is linked to that member once, and that never changes. You cannot refer yourself.</p></li>
              <li><h3>Only real buys count</h3><p>The friend&rsquo;s first buy through Tropa Club, still held at ${SCOUT_RULES.holdUsd} or more on day 7. Nothing for sign-ups or joins. (This is not the ${REAL_FAN_USD} real-holder line.)</p></li>
              <li><h3>No credit for wallets you funded</h3><p>No credit when you funded the friend&rsquo;s wallet, or you share a first funder.</p></li>
              <li><h3>Badges</h3><p>A Scout stamp on your ticket at {SCOUT_RULES.scoutAt === 1 ? '1 friend who counts' : `${SCOUT_RULES.scoutAt} friends who count`}, a Captain&rsquo;s armband at {SCOUT_RULES.captainAt}. The first {fmtInt(SCOUT_RULES.foundersLimit)} wallets whose first buy is still held on day 7 get the First {fmtInt(SCOUT_RULES.foundersLimit)} stamp.</p></li>
              <li><h3>No prizes</h3><p>{SCOUT_COPY}</p></li>
            </ul>
          )}
          <p className="after-table"><a className="btn" href={`${DOCS_URL}/scoring-and-seasons#${caps ? 'caps' : 'scouts'}`} rel="noopener">The rules in the docs</a></p>
        </div>
      </section>

      <NextStrip
        items={[
          { title: 'Your ticket', sub: 'Your rank in every ground you are in', mine: 'ticket' },
          caps ? { title: 'Top referrers (Scouts)', sub: 'Friends whose first buy was still held at day 7', href: '/league?tab=scouts' } : { title: 'Points (Caps)', sub: 'Points for buying and holding', href: '/league?tab=caps' },
        ]}
      />
    </main>
  );
}
