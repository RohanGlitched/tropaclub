import type { Metadata } from 'next';
import Link from 'next/link';
import { ClubLeagueTable, PreseasonTable, SupportersTable } from '@/components/club/Tables';
import StockClubList from '@/components/club/StockClubList';
import ClubPreview from '@/components/ClubPreview';
import { Pennant } from '@/components/ds/Pennant';
import { crestOf, ensureStockClubs, tryClubs } from '@/lib/server/clubs';
import { getIndex } from '@/lib/server/data';
import { fmtInt } from '@/lib/format';
import { isListedClub, publicName } from '@tropaclub/clubs';
import { BOARD_PAGE, BoardPager, CapsBoard, ScoutsBoard } from '@/components/club/Boards';
import { boardNames, capsBoard, scoutsBoard } from '@/lib/server/honours';
import { CAPS_COPY, CAPS_RULES, DOCS_URL, OPENS, PLAY_USD, RULE_LINE, SCOUT_COPY, SCOUT_COUNTS, SCOUT_RULES } from '@/lib/site';

export const metadata: Metadata = {
  title: 'The league: club standings and the Supporters table',
  description: 'Standings for private and pick-up clubs on Tropa Club, and the Supporters table for stock clubs, ranked on turnout and streaks.',
};

type Tab = 'tables' | 'caps' | 'scouts';
type Search = { searchParams: Promise<{ tab?: string | string[]; page?: string | string[] }> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const TABS: { id: Tab; label: string; href: string }[] = [
  { id: 'tables', label: 'Club tables', href: '/league' },
  { id: 'caps', label: 'Caps', href: '/league?tab=caps' },
  { id: 'scouts', label: 'Top scouts', href: '/league?tab=scouts' },
];

export default async function LeaguePage({ searchParams }: Search) {
  const sp = await searchParams;
  const tab: Tab = one(sp.tab) === 'caps' ? 'caps' : one(sp.tab) === 'scouts' ? 'scouts' : 'tables';
  const page = Math.max(1, Math.min(10_000, Math.floor(Number(one(sp.page)) || 1)));
  const tabs = (
    <nav className="board-tabs" aria-label="League tables">
      {TABS.map((t) => (
        <Link key={t.id} href={t.href} prefetch={false} aria-current={t.id === tab ? 'page' : undefined}>{t.label}</Link>
      ))}
    </nav>
  );
  if (tab !== 'tables') return <BoardPage tab={tab} page={page} tabs={tabs} />;

  const [{ data: index }, data] = await Promise.all([
    getIndex(),
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
  const sup = (data?.sup.rows ?? []).filter((r) => r.members > 0).map((r) => ({ ...r, crest: crest(r.clubId, r.crestSeed), note: r.stockSymbol }));
  const season = league.length > 0;
  const founded = (data?.clubs ?? []).filter((c) => c.kind !== 'stock');
  // A club is listed once it has a second member or a member has made a qualifying buy.
  const founding = founded.filter((c) => isListedClub(c)).sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  const stock = new Map((data?.clubs ?? []).filter((c) => c.kind === 'stock').map((c) => [c.stockSymbol, c]));
  const stockRows = index.tokens.map((t) => ({ symbol: t.symbol, name: t.name, realFans: t.realFans, supporters: stock.get(t.symbol)?.memberCount ?? 0, playing: stock.get(t.symbol)?.playingCount ?? 0 }));

  return (
    <main id="main">
      <section className="wrap page-head">
        <h1>The league</h1>
        <p className="lede">
          Private and pick-up clubs play fixtures against clubs their size. Stock clubs have a table of their own. Every number here is a head count or a percentage: no club is ranked by how much money it holds.
        </p>
        <p className="asof">
          {season
            ? `Through ${data?.league.throughGw?.replace('GW', 'gameweek ') ?? 'the last gameweek'}.`
            : pre.length
              ? 'Gameweek 0 is preseason: no fixtures yet, so clubs are listed by turnout.'
              : `The season opens ${OPENS} with gameweek 0, a preseason week. Fixtures start the week after.`}
        </p>
      </section>

      <div className="wrap">{tabs}</div>

      {!data ? (
        <section className="wrap section-tight"><p className="notice">The tables could not be loaded just now. Try again in a minute.</p></section>
      ) : season || pre.length ? (
        <section className="wrap section-tight" id="league" aria-label={season ? 'League table' : 'Preseason table'}>
          <h2 className="h3 table-title">{season ? 'League table' : 'Preseason table'}</h2>
          {season ? <ClubLeagueTable rows={league} /> : <PreseasonTable rows={pre} />}
        </section>
      ) : (
        <section className="wrap section-tight" id="league" aria-label="Founding clubs">
          <div className="split">
            <div className="split-text">
              <h2 className="h3 table-title">Founding clubs</h2>
              {founding.length ? (
                <>
                  <p className="muted">Clubs founded before the first gameweek, in the order they were founded. A club is listed once a second member joins or a member buys, and needs three members to enter the table.</p>
                  <ol className="founding">
                    {founding.slice(0, 30).map((c, i) => (
                      <li key={c.id}>
                        <span className="founding-no num">No. {i + 1}</span>
                        <Pennant kit={crestOf(c)} width={20} />
                        <Link href={`/club/${c.id}`} prefetch={false}>{publicName(c.name)}</Link>
                        <span className="founding-n">{fmtInt(c.memberCount)} {c.memberCount === 1 ? 'member' : 'members'}{c.memberCount < 3 ? `, ${3 - c.memberCount} more to enter the table` : ''}</span>
                      </li>
                    ))}
                  </ol>
                  {founding.length > 30 && <p className="muted small">And {fmtInt(founding.length - 30)} more.</p>}
                </>
              ) : (
                <p className="notice">{founded.length ? 'No club has a second member yet. A club is listed here once one joins or a member buys.' : 'No club has been founded yet. The first one is listed here as founding club No. 1.'}</p>
              )}
              <p className="after-table"><Link className="btn btn-accent" href="/clubs#start">Found club No. {fmtInt(founded.length + 1)}</Link></p>
            </div>
            <div className="split-text">
              <h2 className="h3 table-title">A Matchday, in preview</h2>
              <p className="muted">Made-up names. This is the card every club gets once its members start buying.</p>
              <div className="preview-frame"><span className="tag">Preview</span><ClubPreview /></div>
            </div>
          </div>
        </section>
      )}

      {data && (
        <section className="band" id="supporters">
          <div className="wrap">
            <div className="section-head">
              <h2>Supporters table</h2>
              <p>Stock clubs, one for every stock. Ranked on the share of supporters who played this gameweek, then on the share who are on a payday streak. Returns play no part.</p>
            </div>
            {sup.length ? (
              <SupportersTable rows={sup} />
            ) : (
              <>
                <p className="muted">No stock club has a supporter yet, so there is nothing to rank. These are the biggest crowds. Take a free seat and the club enters the table.</p>
                <StockClubList rows={stockRows} first={8} />
              </>
            )}
          </div>
        </section>
      )}

      <section className="wrap section">
        <div className="section-head"><h2>How the tables work</h2></div>
        <ul className="limits">
          <li><h3>You play by buying</h3><p>{RULE_LINE} Everyone else is on the Bench that week.</p></li>
          <li><h3>Three for a win</h3><p>A fixture goes to the club whose playing members had the higher median return for the gameweek. Win three points, draw one.</p></li>
          <li><h3>One for turning up</h3><p>Any club with 80% or more of its members playing earns a bonus point, win or lose.</p></li>
          <li><h3>Drawn by size</h3><p>Clubs need three members to be drawn, and they meet clubs in the same size band.</p></li>
          <li><h3>Median, not total</h3><p>The middle member’s percentage decides it, so one big wallet cannot carry a club and small buys count in full.</p></li>
          <li><h3>Bragging rights only</h3><p>No prize, perk or payout ever depends on a return. Stock clubs ignore returns altogether.</p></li>
        </ul>
        <p className="after-table"><a className="btn" href={DOCS_URL} rel="noopener">Scoring rules in the docs</a></p>
      </section>

      <section className="closing">
        <div className="wrap closing-in">
          <h2>Put your club on the table</h2>
          <p>Three members and one gameweek is all it takes.</p>
          <p className="closing-links"><Link className="btn btn-accent" href="/clubs#start">Found a club</Link><Link href="/stats">Stats</Link></p>
        </div>
      </section>
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
        <h1>{caps ? 'Caps' : 'Top scouts'}</h1>
        <p className="lede">
          {caps
            ? 'The season scoreboard. A cap is an appearance: you earn them for playing a gameweek and for still holding a week later, never for the size of a buy.'
            : 'Members who brought a friend who became a real fan. Ranked on credited mates who still hold, then on credited mates.'}
        </p>
        <p className="asof">Cosmetic only: nothing here is money or a token.</p>
      </section>
      <section className="wrap section-tight" aria-label={caps ? 'Caps table' : 'Top scouts table'}>
        {tabs}
        {!all ? (
          <p className="notice">The table could not be loaded just now. Try again in a minute.</p>
        ) : !total ? (
          <p className="notice">
            {caps
              ? `No Caps yet. The first are awarded once gameweek 0 buys are recorded, from ${OPENS}.`
              : 'No scout has a credited mate yet. A credit is decided seven days after a friend’s first buy.'}
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
          <div className="section-head"><h2>{caps ? 'How Caps are earned' : 'How scouting works'}</h2></div>
          {caps ? (
            <ul className="limits">
              <li><h3>{CAPS_RULES.played.toFixed(2)} for playing</h3><p>A qualifying verified buy of ${PLAY_USD} or more in the gameweek.</p></li>
              <li><h3>{CAPS_RULES.heldD7.toFixed(2)} for holding on</h3><p>That gameweek&rsquo;s buy still held, ${SCOUT_RULES.holdUsd} or more, seven days later.</p></li>
              <li><h3>{CAPS_RULES.scout.toFixed(2)} per credited scout</h3><p>Up to {CAPS_RULES.scoutPerGw} a gameweek, for a friend whose first buy still held at seven days.</p></li>
              <li><h3>{CAPS_RULES.perGw.toFixed(2)} at most</h3><p>A hard cap per wallet per gameweek, whatever happens.</p></li>
              <li><h3>Nothing for noise</h3><p>No Caps for sign-ups, joins, follows, likes or reposts, and none for history before launch.</p></li>
              <li><h3>Ties</h3><p>Equal totals are split by the earlier first verified buy.</p></li>
            </ul>
          ) : (
            <ul className="limits">
              <li><h3>Your link</h3><p>Every member has a personal link, tropaclub.xyz/j/ and a code. Club invites you send carry it too.</p></li>
              <li><h3>First touch</h3><p>A new wallet that arrives through it is linked to you once, and that never changes. You cannot scout yourself.</p></li>
              <li><h3>Only a real fan counts</h3><p>The friend&rsquo;s first verified buy, still held at ${SCOUT_RULES.holdUsd} or more seven days later. Nothing for sign-ups or joins.</p></li>
              <li><h3>Not the same money</h3><p>No credit when the friend was funded by you, or you share a first funder.</p></li>
              <li><h3>Stamps</h3><p>A Scout stamp on your ticket at {SCOUT_RULES.scoutAt === 1 ? 'one credited mate' : `${SCOUT_RULES.scoutAt} credited mates`}, a Captain&rsquo;s armband at {SCOUT_RULES.captainAt}. The first {fmtInt(SCOUT_RULES.foundersLimit)} wallets whose first buy still held at seven days get the Founders&rsquo; Pennant.</p></li>
              <li><h3>Nothing to win</h3><p>{SCOUT_COPY}</p></li>
            </ul>
          )}
          <p className="after-table"><a className="btn" href={`${DOCS_URL}/scoring-and-seasons#${caps ? 'caps' : 'scouts'}`} rel="noopener">The rules in the docs</a></p>
        </div>
      </section>
    </main>
  );
}
