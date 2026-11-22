/**
 * Season definitions shared by the Caps ledger (caps.ts) and the season module (season.ts). The
 * values and every sentence shown about them live in web/lib/rules.json (season1), which the site
 * and the docs build read too.
 */
import rules from '../../web/lib/rules.json';

export type SeasonId = 'S1';

const s1 = rules.season1;
export const SEASON1 = {
  id: 'S1' as SeasonId,
  name: s1.name,
  startAt: Math.floor(Date.parse(s1.startAt) / 1000),
  /** The snapshot: the end of GW1 (Fri Dec 4 16:00 ET). */
  endAt: Math.floor(Date.parse(s1.endAt) / 1000),
  gameweeks: s1.gameweeks as readonly string[],
  provisionalSec: s1.provisionalHours * 3600,
  founderCaps: rules.caps.founder,
  social: s1.social,
} as const;

/** The season a gameweek's Caps count toward, or null for a later one not defined yet. */
export const seasonOfGw = (gw: string): SeasonId | null => (SEASON1.gameweeks.includes(gw) ? 'S1' : null);

export const SEASON_COL = {
  /** server only: per wallet per season, the age check and the provisional decision */
  wallets: 'seasonWallets',
  /** server only: self-reported social quest claims, with spot-check status */
  social: 'socialClaims',
  /** server only: wallet -> X handle */
  profiles: 'socialProfiles',
  /** server only: X handle (lowercase) -> wallet, the unique index */
  handles: 'xHandles',
} as const;

export type ProvisionalReason = 'new_wallet' | 'age_unknown' | 'age_unchecked';

export interface SeasonWalletDoc {
  id: string; // `${season}__${wallet}`
  wallet: string;
  season: SeasonId;
  firstBuyAt: number | null;
  /** First inbound value or transaction, when found inside the 30-day window. */
  bornAt: number | null;
  /** Already active before the window: not new. */
  olderThanWindow: boolean;
  ageCheckedAt: number | null;
  provisional: boolean;
  provisionalReason: ProvisionalReason | null;
  /** Set at the snapshot for a provisional wallet: kept (counts) or dropped (gets no allocation). */
  decision: 'kept' | 'dropped' | null;
  decidedAt: number | null;
  decisionNote: string | null;
  updatedAt: number;
}
