import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import BuyCta from '@/components/buy/BuyCta';
import { InviteBox, JoinButton, Roster } from '@/components/club/Actions';
import { Crest, Pennant } from '@/components/ds/Pennant';
import Scoreboard from '@/components/ds/Scoreboard';
import type { Member } from '@/components/ds/TeamSheet';
import { crestOf, tryClubs } from '@/lib/server/clubs';
import { requestRegion } from '@/lib/server/geo';
import { sessionWallet } from '@/lib/server/session';
import { fmtDate, fmtInt } from '@/lib/format';
import { groundPath } from '@/lib/clubs';
import { OPENS, PLAY_USD, RULE_LINE, buyOpenAt } from '@/lib/site';

type Params = { params: Promise<{ id: string }>; searchParams: Promise<{ joined?: string; join?: string; callup?: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const club = await tryClubs((svc) => svc.getClub(decodeURIComponent(id)), 8000);
  return club ? { title: `${club.name}: team sheet and Matchday`, description: `${club.name} on Tropa Club: ${club.memberCount} members, ${club.playingCount} playing. $10 a week in stocks with the group chat.` } : { title: 'Club' };
}

const KIND: Record<string, string> = { private: 'Private club', pickup: 'Pick-up club', stock: 'Stock club' };
const signed = (n: number | null | undefined) => (n == null ? null : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`);
const FIXTURE: Record<string, string> = {
  preseason: 'Gameweek 0 is preseason: no fixtures, just a table.',
  bye: 'No opponent this week: a bye.',
  none: 'No fixture this gameweek. Clubs need three members to be drawn.',
  leading: 'Ahead in this week’s fixture',
  trailing: 'Behind in this week’s fixture',
  level: 'Level in this week’s fixture',
  won: 'Won this week’s fixture',
  lost: 'Lost this week’s fixture',
  drawn: 'Drew this week’s fixture',
};

export default async function ClubPage({ params, searchParams }: Params) {
  const [{ id: rawId }, sp] = await Promise.all([params, searchParams]);
  const id = decodeURIComponent(rawId);
  const [region, viewer] = await Promise.all([requestRegion(), sessionWallet()]);
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
      note: played ? (ret ? `${ret} this week` : undefined) : m.seat === 'playing' ? 'Has not bought this week' : 'On the Bench, yet to buy',
      canCallUp: !!m.wallet && canCall.has(m.wallet),
    };
  });
  const played = md?.played ?? 0;
  // members who joined after the last close are on the Bench until the next one
  const benched = Math.max(club.memberCount - played, 0);
  const turnout = club.memberCount ? Math.round((played / club.memberCount) * 100) : 0;
  const callUpOff = !me?.member
    ? undefined
    : region.us
      ? 'Call-ups are not available to US persons.'
      : !md
        ? `Call-ups open with the first gameweek on ${OPENS}.`
        : !me.playedThisGw
          ? `Play this gameweek (buy $${PLAY_USD} or more) to call up a teammate.`
          : canCall.size === 0 && benched > 0
            ? 'You have called up everyone you can this gameweek.'
            : undefined;

  return (
    <main id="main">
      <section className="wrap page-head">
        <p className="crumbs"><Link href="/clubs">Clubs</Link> <span aria-hidden="true">/</span> {KIND[club.kind] ?? 'Club'}{club.regionLabel ? `, ${club.regionLabel}` : ''}</p>
        <div className="club-title">
          <Crest recipe={crest} width={64} raise={sp.joined === '1'} title={`Crest of ${club.name}`} />
          <div>
            <h1>{club.name}</h1>
            <p className="ground-line">
              <span className="num">{fmtInt(club.memberCount)}</span> {club.memberCount === 1 ? 'member' : 'members'}, <span className="num">{fmtInt(club.playingCount)}</span> with a Playing seat
            </p>
          </div>
        </div>
        {sp.joined === '1' && me?.member && <p className="notice notice-ok" role="status">You have a seat on the Bench at {club.name}. {RULE_LINE}</p>}
        {sp.callup && !me?.playedThisGw && <p className="notice" role="status">You have been called up. {club.name} needs you playing this week for the 80% bonus.</p>}
      </section>

      <section className="wrap section-tight club-main">
        <div className="club-board">
          <Scoreboard
            title={md ? 'Matchday' : 'Before kick-off'}
            kicker={md ? `${md.gw.label.replace(' · ', ', ')}${md.final ? ', final' : md.cut ? `, as of the ${fmtDate(md.cut.closeAt).replace(/ \d{4}$/, '')} close` : ', live'}` : `Opens ${OPENS}`}
            cells={[
              { label: 'Played', value: played },
              { label: 'Bench', value: benched },
              { label: 'Turnout %', value: turnout, pad: 2 },
            ]}
            foot={
              md ? (
                <>
                  {turnout >= 80 && played > 0 ? 'Bonus point earned: 80% or more played. ' : played > 0 ? `${Math.max(0, Math.ceil(club.memberCount * 0.8) - played)} more to play for the 80% bonus. ` : 'Nobody has played yet. '}
                  {md.topScorer && <>Top scorer {md.topScorer.nickname ?? md.topScorer.who}, {signed(md.topScorer.returnPct)}. </>}
                  {!isStock && md.score != null && <>Club median {signed(md.score)}. </>}
                </>
              ) : (
                `The first gameweek opens ${OPENS}. Until then every seat is on the Bench.`
              )
            }
          />
          {md && !isStock && (
            <p className="fixture">
              <b>{FIXTURE[md.fixture.status] ?? 'Fixture'}</b>
              {md.fixture.opponent && (
                <>
                  {' '}against <Link href={`/club/${md.fixture.opponent.id}`}>{md.fixture.opponent.name}</Link>
                  {md.fixture.opponentScore != null && md.score != null && <> ({signed(md.score)} to {signed(md.fixture.opponentScore)})</>}
                </>
              )}
            </p>
          )}
          <p className="muted small">Returns are status only: no prize depends on them. Past performance · not advice.</p>

          <div className="club-actions">
            {!me?.member ? (
              isStock ? (
                <JoinButton clubId={club.id} label={`Support ${club.name}`} />
              ) : sp.join ? (
                <JoinButton inviteCode={sp.join} />
              ) : (
                <p className="notice">This club is joined with an invite link from one of its members.</p>
              )
            ) : (
              <BuyCta clubId={club.id} token={club.stockToken} symbol={club.stockSymbol ?? undefined} openAt={openAt} label={me.playedThisGw ? 'Buy again' : 'Buy and play this week'} compact />
            )}
            {me?.member && <p className="muted small">Buys here don’t earn third-party cashback.</p>}
          </div>
        </div>

        <div className="club-sheet" id="team">
          <h2 className="h3">Team sheet{md ? `, ${md.gw.id.replace('GW', 'gameweek ')}` : ''}</h2>
          <Roster
            clubId={club.id}
            clubName={club.name}
            members={members}
            crest={crest}
            callUpOff={callUpOff}
            playingLabel={md ? 'Played' : 'Playing'}
            joined={sp.joined === '1'}
          />
          {members.length === 0 && <p className="notice">No members yet. Be the first on the Bench.</p>}
        </div>
      </section>

      {me?.invite && (
        <section className="band" id="invite">
          <div className="wrap split">
            <div className="split-text">
              <h2>Invite the group chat</h2>
              <p>Anyone who opens this link can take a free seat on the Bench. Only members can see it.</p>
            </div>
            <InviteBox url={me.invite.url} club={club.name} />
          </div>
        </section>
      )}

      <section className="wrap section">
        <div className="section-head">
          <h2>{isStock ? 'How a stock club works' : 'How this club is scored'}</h2>
        </div>
        <ul className="limits">
          {isStock ? (
            <>
              <li><h3>Open to every supporter</h3><p>Anyone can take a seat. {RULE_LINE} Here, the buy has to be {club.stockSymbol}.</p></li>
              <li><h3>Ranked on turnout</h3><p>Stock clubs sit in the Supporters table: share of members who played, then share on a payday streak. Returns play no part.</p></li>
              <li><h3>Same club, same ground</h3><p>This is the club whose seats you can walk in The Ground. <Link href={groundPath(club.stockSymbol ?? '')}>See the ground</Link></p></li>
            </>
          ) : (
            <>
              <li><h3>Played or Bench</h3><p>{RULE_LINE} Any stock token counts. Everyone else is on the Bench for that week.</p></li>
              <li><h3>The 80% bonus</h3><p>When four in five members play, the club earns a bonus point. One call-up per teammate each week helps get there.</p></li>
              <li><h3>Fixtures</h3><p>From gameweek 1, clubs of three or more are drawn against clubs their size. The higher median return among playing members takes three points.</p></li>
            </>
          )}
          <li><h3>Payday streaks</h3><p>One buy of ${PLAY_USD} or more in any 14 days keeps a personal streak alive, with one free skip a month.</p></li>
          <li><h3>Status, not prizes</h3><p>Scores are bragging rights. Nothing of value is ever handed out for a return.</p></li>
          <li><h3>Your records</h3><p>Every member can print their own cost-basis statement. {viewer ? <Link href={`/statement/${viewer}`}>Open yours</Link> : 'Connect a wallet to open yours.'}</p></li>
        </ul>
        <p className="after-table">
          <Link className="btn" href={isStock ? '/league#supporters' : '/league'}>{isStock ? 'Supporters table' : 'League table'}</Link>
        </p>
      </section>

      <section className="closing">
        <div className="wrap closing-in">
          <div className="closing-crests" aria-hidden="true"><Pennant kit={crest} width={34} rail /></div>
          <h2>{me?.member ? 'Fill the Bench' : `Not in ${club.name}?`}</h2>
          <p>{me?.member ? 'A full team is worth a bonus point every week. Send the invite.' : 'Found your own club in a minute. It is free.'}</p>
          <p className="closing-links"><Link className="btn btn-accent" href="/clubs#start">Found a club</Link><Link href="/clubs">All clubs</Link><Link href="/league">The league</Link></p>
        </div>
      </section>
    </main>
  );
}
