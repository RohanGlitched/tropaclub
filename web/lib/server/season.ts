// Season 1 (the $TROPA airdrop qualifier) for pages and routes: the public numbers, one wallet's
// standing, and the signed-in wallet's social quests. Cached 60 s per instance like the boards.
import 'server-only';
import type { SeasonStanding, SeasonStats, SocialState } from '@tropaclub/clubs';
import { tryClubs } from './clubs';

export type { SeasonStanding, SeasonStats, SocialState };

const TTL_MS = 60_000;
const memo = new Map<string, { at: number; p: Promise<unknown> }>();
function cached<T>(key: string, run: () => Promise<T | null>): Promise<T | null> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.p as Promise<T | null>;
  const p = run().then((v) => {
    if (v == null) memo.delete(key); // a failure is not kept
    return v;
  });
  if (memo.size > 2000) memo.clear();
  memo.set(key, { at: Date.now(), p });
  return p;
}

/** Totals, provisional counts and the exclusion-reason counts. Null if the clubhouse is slow. */
export const getSeasonStats = (ms = 8000) => cached<SeasonStats>('stats', () => tryClubs((svc) => svc.seasonStats(), ms));

/** One wallet's Season 1 Caps, rank and breakdown (public: no handle). */
export const getSeasonStanding = (wallet: string, ms = 8000) =>
  cached<SeasonStanding>(`w:${wallet.toLowerCase()}`, () => tryClubs((svc) => svc.seasonStanding(wallet), ms));

/** The signed-in wallet's social quests and handle. Never cached: it changes on a click. */
export const getSocialState = (wallet: string, ms = 8000) => tryClubs((svc) => svc.socialOf(wallet), ms);

/** The Season 1 announcement post (SEASON_POST_ID), or null until it is set. */
export function seasonPostId(): string | null {
  const id = (process.env.SEASON_POST_ID ?? '').trim();
  return /^\d{5,25}$/.test(id) ? id : null;
}
