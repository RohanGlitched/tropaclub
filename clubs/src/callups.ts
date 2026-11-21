/**
 * Call-ups: a playing member taps a benched teammate on the Matchday card. One call-up per teammate
 * per gameweek per caller. Returns share text + links (WhatsApp, Telegram). Works on peer pressure,
 * never a prize. Hidden (and refused) where buying is blocked.
 */
import { currentGameweek, etDate } from './calendar';
import { getClub, memberId } from './clubs';
import type { ClubsContext } from './context';
import { buyGate } from './geo';
import { loadLedger } from './ledger';
import { playedIn } from './scoring';
import { AlreadyExistsError } from './store/docstore';
import { COL, type CallupDoc, type ClubSecretDoc, type MemberDoc } from './types';
import { ClubsError, normAddr, shortAddr } from './util';

export interface CallupShare {
  id: string;
  text: string;
  url: string;
  whatsapp: string;
  telegram: string;
}

export const callupsVisible = (ctx: ClubsContext, country: string | null) => buyGate(ctx.geo, country).allowed;

function closeCopy(t: number): string {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(t * 1000));
  return `${wd} ET`;
}

export async function sendCallup(ctx: ClubsContext, input: { clubId: string; from: string; to: string; country: string | null }): Promise<CallupShare> {
  if (!callupsVisible(ctx, input.country)) throw new ClubsError('region_blocked', 'Call-ups are not available in your region.', 403);
  const from = normAddr(input.from);
  const to = normAddr(input.to);
  if (from === to) throw new ClubsError('bad_callup', 'You cannot call yourself up.');
  const now = ctx.now();
  const gw = currentGameweek(now);
  if (!gw) throw new ClubsError('no_gameweek', 'No gameweek is open.');
  const club = await getClub(ctx, input.clubId);
  if (!club) throw new ClubsError('club_not_found', 'Club not found.', 404);
  const [mf, mt] = await Promise.all([
    ctx.store.get<MemberDoc>(COL.members, memberId(club.id, from)),
    ctx.store.get<MemberDoc>(COL.members, memberId(club.id, to)),
  ]);
  if (!mf || !mt) throw new ClubsError('not_member', 'Both players must be in this club.', 403);
  const token = club.kind === 'stock' ? club.stockToken : null;
  const [lf, lt] = await Promise.all([loadLedger(ctx, from), loadLedger(ctx, to)]);
  if (!playedIn(lf, gw, now, token).length) throw new ClubsError('not_playing', 'Play this gameweek (buy $10 or more) to call up a teammate.', 403);
  if (playedIn(lt, gw, now, token).length) throw new ClubsError('already_playing', 'They are already playing this gameweek.');

  const id = `${gw.id}__${club.id}__${from}__${to}`;
  try {
    await ctx.store.create<CallupDoc>(COL.callups, id, { id, clubId: club.id, gw: gw.id, from, to, createdAt: now });
  } catch (e) {
    if (e instanceof AlreadyExistsError) throw new ClubsError('already_called_up', 'You already called them up this gameweek.', 409);
    throw e;
  }
  const secret = await ctx.store.get<ClubSecretDoc>(COL.clubSecrets, club.id);
  const nextClose = gw.tradingDays.find((d) => d.closeAt > now) ?? gw.tradingDays[gw.tradingDays.length - 1]!;
  const caller = mf.nickname ?? shortAddr(from);
  const url = `${ctx.config.siteUrl}/club/${encodeURIComponent(club.id)}?callup=${gw.id}${secret ? `&join=${secret.inviteCode}` : ''}`;
  const text = `${caller} called you up for ${club.name} this week. We need you for the 80% bonus: put in $10 before ${gw.id} closes ${closeCopy(gw.cutAt)}${nextClose.date === etDate(gw.cutAt) ? '' : ` (next close ${closeCopy(nextClose.closeAt)})`}.`;
  return {
    id,
    text,
    url,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`,
    telegram: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
  };
}

/** Call-ups sent in a club this gameweek (for the Matchday card: who has been called up). */
export async function listCallups(ctx: ClubsContext, clubId: string, gwId?: string): Promise<{ to: string; count: number }[]> {
  const gw = gwId ?? currentGameweek(ctx.now())?.id;
  if (!gw) return [];
  const rows = await ctx.store.query<CallupDoc>(COL.callups, { where: [['clubId', '==', clubId], ['gw', '==', gw]] });
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.to, (m.get(r.to) ?? 0) + 1);
  return [...m].map(([to, count]) => ({ to: shortAddr(to), count }));
}
