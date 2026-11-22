import type { Metadata } from 'next';
import Link from 'next/link';
import { Crumbs, NextStrip } from '@/components/nav/Wayfinding';
import { notFound } from 'next/navigation';
import BuyCta from '@/components/buy/BuyCta';
import { JoinButton, Roster } from '@/components/club/Actions';
import ScoutInviteBox from '@/components/club/ScoutInviteBox';
import { Crest, Pennant } from '@/components/ds/Pennant';
import Scoreboard from '@/components/ds/Scoreboard';
import type { Member } from '@/components/ds/TeamSheet';
import { isListedClub, publicName } from '@tropaclub/clubs';
import { crestOf, tryClubs } from '@/lib/server/clubs';
import { getIndex } from '@/lib/server/data';
import { requestRegion } from '@/lib/server/geo';
import { sessionWallet } from '@/lib/server/session';
import { fmtDate, fmtInt } from '@/lib/format';
import { groundPath } from '@/lib/clubs';
import { FIXTURE_RULE, OPENS, OPENS_UTC, PLAY_USD, RULE_LINE, STREAK_SHORT, buyOpenAt, groundName, openClubName } from '@/lib/site';

type Params = { params: Promise<{ id: string }>; searchParams: Promise<{ joined?: string; join?: string; callup?: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const club = await tryClubs((svc) => svc.getClub(decodeURIComponent(id)), 8000);
  if (!club) return { title: 'Club' };
  const t = club.kind === 'stock' ? (await getIndex()).data.tokens.find((x) => x.symbol === club.stockSymbol) : null;
  const name = t ? openClubName(t.name, t.symbol) : publicName(club.name);
  // a club that is not on the public lists stays out of search results too
  return { title: `${name}: members and Matchday card`, description: `${name} on Tropa Club: ${club.memberCount} members, ${club.playingCount} bought this week. Friends each buy about $10 of stock tokens a week from their own wallets.`, ...(isListedClub(club) ? {} : { robots: { index: false, follow: false } }) };
}

const KIND: Record<string, string> = { private: 'Private club', pickup: 'Pick-up club', stock: 'Open club (anyone can join)' };
const signed = (n: number | null | undefined) => (n == null ? null : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`);
const FIXTURE: Record<string, string> = {
  preseason: 'Week 0 is a practice week: no pairings yet, clubs are listed by turnout.',
  bye: 'No paired club this week (a bye). The 80% bonus point still counts.',
  none: 'Not paired this week. Clubs need 3 members to be paired.',
  leading: 'Higher return so far in this week’s pairing',
  trailing: 'Lower return so far in this week’s pairing',
  level: 'Level so far in this week’s pairing',
  won: 'Higher return this week: 3 points',
  lost: 'Lower return this week: 0 points',
  drawn: 'Level this week: 1 point each',
};

export default async function ClubPage({ params, searchParams }: Params) {
  const [{ id: rawId }, sp] = await Promise.all([params, searchParams]);
  const id = decodeURIComponent(rawId);
  const [region, viewer, { data: index }] = await Promise.all([requestRegion(), sessionWallet(), getIndex()]);
  const res = await tryClubs(async (svc) => {
    try {
      return { page: await svc.getClubPage(id, { viewer, country: region.country }), now: svc.ctx.now() };
    } catch (e) {
      if ((e as { code?: string }).code === 'club_not_found') return 'missing' as const;
      throw e;
    }
  });
  if (res === 'missing') notFound();
  if (!res) {
    return (
      <main id="main">
        <section className="wrap page-head empty">
          <h1>The clubhouse is not answering</h1>
          <p className="lede">This club could not be loaded just now. Nothing is lost: seats and buys are safe. Try again in a minute.</p>
          <p className="closing-links"><Link className="btn" href={`/club/${rawId}`}>Try again</Link><Link href="/clubs">All clubs</Link></p>
        </section>
      </main>
    );
  }
  const { page, now } = res;
  const { club, matchday: md, viewer: me } = page;
  const crest = crestOf(club);
  const openAt = buyOpenAt();
  void now;
  const isStock = club.kind === 'stock';
  const stockTok = isStock ? index.tokens.find((t) => t.symbol === club.stockSymbol) ?? null : null;
  const name = stockTok ? openClubName(stockTok.name, stockTok.symbol) : club.name;
  // "the NVIDIA open club" reads right in a sentence; a friend club's own name does not take "the"
  const theName = stockTok ? `the ${name}` : name;
  const lineup = new Map((md?.lineup ?? []).map((l) => [l.who, l]));
  const canCall = new Set(me?.canCallUp ?? []);
  const members: Member[] = page.members.map((m) => {
    const l = lineup.get(m.who);
    const played = md ? !!l?.played : m.seat === 'playing';
    const ret = signed(l?.returnPct);
    return {
      id: m.wallet ?? m.who,
      name: m.nickname ?? m.who,
      status: played ? 'playing' : 'bench',
      you: m.isViewer,
      badge: m.streakBadge?.replace(' · ', ', ') ?? null,
      note: played ? (ret ? `${ret} this week` : undefined) : 'Not bought yet this week',
      canCallUp: !!m.wallet && canCall.has(m.wallet),
    };
  });
  const played = md?.played ?? 0;
  // members who joined after the last close show on the Bench until the next one
  const benched = Math.max(club.memberCount - played, 0);
  const turnout = club.memberCount ? Math.round((played / club.memberCount) * 100) : 0;
  const callUpOff = !me?.member
    ? undefined
    : region.blocked
      ? "Nudges aren't available in your region."
      : !md
        ? `Nudges open when buying opens, ${OPENS_UTC}.`
        : !me.playedThisGw
          ? `Buy $${PLAY_USD} or more this gameweek to nudge a teammate.`
          : canCall.size === 0 && benched > 0
            ? 'You have nudged everyone you can this gameweek.'
            : undefined;

  return (
    <main id="main">
      <section className="wrap page-head">
        <Crumbs trail={[{ label: 'Clubs', href: '/clubs' }, { label: name }]} note={`${KIND[club.kind] ?? 'Club'}${club.regionLabel ? `, ${club.regionLabel}` : ''}`} />
        <div className="club-title">
          <Crest recipe={crest} width={64} raise={sp.joined === '1'} title={`Crest of ${name}`} />
          <div>
            <h1>{name}{isStock ? ' (anyone can join)' : ''}</h1>
            <p className="ground-line">
              <span className="num">{fmtInt(club.memberCount)}</span> {club.memberCount === 1 ? 'member' : 'members'}. <span className="num">{fmtInt(club.playingCount)}</span> bought this week.
            </p>
          </div>
        </div>
        {isStock && stockTok && (
          <p className="lede">
            An open club for anyone who wants to buy {stockTok.symbol} each week. Here, the buy has to be {stockTok.symbol}. It&rsquo;s ranked on how many members buy, never on returns. Its members are people who joined this club{club.memberCount === 0 ? ', so it has none yet' : ''}. The <Link href={groundPath(stockTok.symbol)}>{groundName(stockTok.name, stockTok.symbol)}</Link> is different: it counts every holder of the token, and its {fmtInt(stockTok.realFans)} real holders don&rsquo;t need to join anything.
          </p>
        )}
        {sp.joined === '1' && me?.member && <p className="notice notice-ok" role="status">You joined {theName}. You show on the Bench until you buy this week. {RULE_LINE}</p>}
        {sp.callup && !me?.playedThisGw && <p className="notice" role="status">A teammate sent you a nudge. If 80% of {theName} buys this week, the club gets a bonus point.</p>}
      </section>

      <section className="wrap section-tight club-main">
        <div className="club-board">
          <Scoreboard
            title={md ? 'Matchday card' : 'Not started yet'}
            kicker={md ? `${md.gw.label.replace(' · ', ', ')}${md.final ? ', final' : md.cut ? `, as of the ${fmtDate(md.cut.closeAt).replace(/ \d{4}$/, '')} close` : ', live'}` : `Opens ${OPENS_UTC}`}
            cells={[
              { label: 'Played', value: played },
              { label: 'Bench', value: benched },
              { label: 'Turnout %', value: turnout, pad: 2 },
            ]}
            foot={
              md ? (
                <>
                  {turnout >= 80 && played > 0 ? 'Bonus point earned: 80% or more bought. ' : played > 0 ? `${Math.max(0, Math.ceil(club.memberCount * 0.8) - played)} more ${Math.ceil(club.memberCount * 0.8) - played === 1 ? 'needs' : 'need'} to buy for the 80% bonus point. ` : 'Nobody has bought yet this week. '}
                  {!isStock && md.topScorer && <>Highest return {md.topScorer.nickname ?? md.topScorer.who}, {signed(md.topScorer.returnPct)}. </>}
                  {!isStock && md.score != null && <>Club middle return {signed(md.score)}. </>}
                </>
              ) : (
                `Week 0 starts ${OPENS}. Until then, no one can have bought, so everyone shows as not played yet.`
              )
            }
          />
          {md && !isStock && (
            <p className="fixture">
              <b>{FIXTURE[md.fixture.status] ?? 'Weekly pairing'}</b>
              {md.fixture.opponent && (
                <>
                  {' '}paired with <Link href={`/club/${md.fixture.opponent.id}`}>{md.fixture.opponent.name}</Link>
                  {md.fixture.opponentScore != null && md.score != null && <> ({signed(md.score)} to {signed(md.fixture.opponentScore)})</>}
                </>
              )}
            </p>
          )}
          <p className="muted small">{isStock ? '' : 'Returns are for bragging rights only: no prize depends on them. '}Past results don’t predict future results. Not advice.</p>

          <div className="club-actions">
            {!me?.member ? (
              isStock ? (
                <JoinButton clubId={club.id} label="Join for free" />
              ) : sp.join ? (
                <JoinButton inviteCode={sp.join} />
              ) : (
                <p className="notice">This club is joined with an invite link from one of its members.</p>
              )
            ) : (
              <BuyCta clubId={club.id} token={club.stockToken} symbol={club.stockSymbol ?? undefined} openAt={openAt} label={me.playedThisGw ? 'Buy again this week' : 'Buy this week (counts as played)'} compact />
            )}
            {me?.member && <p className="muted small">Buys here don’t earn third-party cashback.</p>}
          </div>
        </div>

        <div className="club-sheet" id="team">
          <h2 className="h3">Members{md ? `, ${md.gw.id.replace('GW', 'gameweek ')}` : ''}</h2>
          {members.length === 0 ? (
            <div className="sheet-empty-club">
              <h3>No members yet</h3>
              <p>{me?.invite ? 'Nobody else has joined yet. Send the invite link to your group chat.' : 'Join for free. No buy needed.'}</p>
              {me?.invite && <p><a className="btn btn-accent" href="#invite">Invite people</a></p>}
            </div>
          ) : (
          <Roster
            clubId={club.id}
            clubName={name}
            members={members}
            crest={crest}
            callUpOff={callUpOff}
            playingLabel="Played"
            joined={sp.joined === '1'}
          />
          )}
        </div>
      </section>

      {me?.invite && (
        <section className="band" id="invite">
          <div className="wrap split">
            <div className="split-text">
              <h2>Invite the group chat</h2>
              <p>Anyone who opens this link can join for free, with no buy needed. Only members can see it.</p>
            </div>
            <ScoutInviteBox url={me.invite.url} club={name} wallet={viewer} />
          </div>
        </section>
      )}

      <section className="wrap section">
        <div className="section-head">
          <h2>{isStock ? 'How an open club works' : 'How this club is scored'}</h2>
        </div>
        <ul className="limits">
          {isStock ? (
            <>
              <li><h3>Open to everyone</h3><p>Anyone can join for free. {RULE_LINE} Here, the buy has to be {club.stockSymbol}.</p></li>
              <li><h3>Ranked on turnout</h3><p>Open clubs are ranked by the % of members who bought this week, then the % on a buying streak. Returns play no part.</p></li>
              <li><h3>Linked to the {stockTok ? groundName(stockTok.name, stockTok.symbol) : 'ground'}</h3><p>The ground shows every holder of {club.stockSymbol}. This club shows only people who joined here, which is why its counts are smaller. <Link href={groundPath(club.stockSymbol ?? '')}>See the ground</Link></p></li>
            </>
          ) : (
            <>
              <li><h3>Played or Bench</h3><p>{RULE_LINE} Any stock token counts. Members who haven&rsquo;t bought yet that week are on the Bench.</p></li>
              <li><h3>The 80% bonus</h3><p>If 80% or more of members buy that week, the club gets a bonus point. One nudge per teammate each week helps get there.</p></li>
              <li><h3>Weekly pairings (fixtures)</h3><p>{FIXTURE_RULE}</p></li>
            </>
          )}
          <li><h3>Streaks</h3><p>{STREAK_SHORT}</p></li>
          <li><h3>Status, not prizes</h3><p>Scores are bragging rights. Nothing of value is ever handed out for a return.</p></li>
          <li><h3>Your records</h3><p>Every member can open their own cost-basis statement. {viewer ? <Link href={`/statement/${viewer}`}>Open yours</Link> : 'Connect a wallet to open yours.'}</p></li>
        </ul>
        <p className="after-table">
          <Link className="btn" href={isStock ? '/league#supporters' : '/league'}>{isStock ? 'Open club rankings' : 'Club rankings'}</Link>
        </p>
      </section>

      <section className="closing">
        <div className="wrap closing-in">
          <div className="closing-crests" aria-hidden="true"><Pennant kit={crest} width={34} rail /></div>
          <h2>{me?.member ? 'Invite more friends' : `Not in ${theName}?`}</h2>
          <p>{me?.member ? 'If 80% of members buy each week, the club gets a bonus point. Send the invite.' : 'Start your own club in a minute. It is free.'}</p>
          <p className="closing-links"><Link className="btn btn-accent" href="/clubs#start">Start a club</Link><Link href="/clubs">All clubs</Link><Link href="/league">Club rankings</Link></p>
        </div>
      </section>

      <NextStrip
        items={[
          isStock ? { title: 'Open club rankings', sub: 'Ranked on how many members buy', href: '/league#supporters' } : { title: 'Club rankings', sub: 'Where this club stands', href: '/league' },
          { title: 'Your ticket', sub: 'Your rank in every ground you are in', mine: 'ticket' },
        ]}
      />
    </main>
  );
}
