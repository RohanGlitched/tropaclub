/**
 * NYSE gameweeks for Season 0 (Nov 2026 - Jan 2027).
 *
 * - A gameweek runs Mon open -> Fri close (the last trading day's close).
 * - GW0 (preseason, table only) opens with clubs on Tue Nov 24 and closes Fri Nov 27 at 13:00 ET (half day).
 * - GW1 = Nov 30 - Dec 4, the first gameweek with fixtures.
 * - Buy window of GWn = (cut of GWn-1, cut of GWn]: weekend buys (DEX trades 24/7) count for the next gameweek.
 * - Matchday standings cut at each trading day's close: 16:00 ET, or 13:00 ET on half days.
 */
import { ClubsError, DAY } from './util';

/** NYSE full closures (ET dates) in the season window. */
export const NYSE_HOLIDAYS: ReadonlySet<string> = new Set(['2026-11-26', '2026-12-25', '2027-01-01', '2027-01-18']);
/** Early closes (13:00 ET). */
export const NYSE_HALF_DAYS: ReadonlySet<string> = new Set(['2026-11-27', '2026-12-24']);

/** Clubs and buys go live: Tue Nov 24 2026 00:00 ET. */
export const LAUNCH_DATE_ET = '2026-11-24';
export const SEASON_END_DATE_ET = '2027-01-29';

const etFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function etWall(tSec: number): { date: string; h: number; m: number; s: number } {
  const p = Object.fromEntries(etFmt.formatToParts(new Date(tSec * 1000)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, h: Number(p.hour), m: Number(p.minute), s: Number(p.second) };
}

/** ET date (YYYY-MM-DD) of a unix time. */
export const etDate = (tSec: number) => etWall(tSec).date;

/** Unix seconds of an ET wall-clock time (DST-aware via Intl). */
export function etToUtc(date: string, hour = 0, minute = 0): number {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const wallAsUtc = Date.UTC(y, mo - 1, d, hour, minute) / 1000;
  let guess = wallAsUtc + 5 * 3600;
  for (let i = 0; i < 3; i++) {
    const w = etWall(guess);
    const [wy, wmo, wd] = w.date.split('-').map(Number) as [number, number, number];
    const seen = Date.UTC(wy, wmo - 1, wd, w.h, w.m, w.s) / 1000;
    const diff = wallAsUtc - seen;
    if (diff === 0) break;
    guess += diff;
  }
  return guess;
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

export const isHoliday = (date: string) => NYSE_HOLIDAYS.has(date);
export const isHalfDay = (date: string) => NYSE_HALF_DAYS.has(date);
export function isTradingDay(date: string): boolean {
  const wd = weekday(date);
  return wd >= 1 && wd <= 5 && !isHoliday(date);
}

/** Regular-session close of a trading day (16:00 ET, 13:00 ET on half days), unix seconds. */
export function closeOf(date: string): number {
  if (!isTradingDay(date)) throw new ClubsError('not_trading_day', `${date} is not an NYSE trading day`);
  return etToUtc(date, isHalfDay(date) ? 13 : 16, 0);
}
export const openOf = (date: string) => etToUtc(date, 9, 30);

export interface Matchday {
  date: string; // ET date
  closeAt: number;
  halfDay: boolean;
}

export interface Gameweek {
  id: string; // "GW0"
  index: number;
  season: number;
  preseason: boolean;
  label: string; // "GW1 · Nov 30 – Dec 4"
  tradingDays: Matchday[];
  /** First trading day's 09:30 ET open (GW0: clubs launch time). */
  openAt: number;
  /** Buys with blockTime in (buyFrom, cutAt] count for this gameweek. */
  buyFrom: number;
  /** Last trading day's close: standings and fixture results cut here. */
  cutAt: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDay = (date: string) => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`;

function buildSeason(): Gameweek[] {
  const out: Gameweek[] = [];
  // Week Mondays from Nov 23 2026 (GW0's week) to the season end.
  let monday = '2026-11-23';
  let prevCut = etToUtc(LAUNCH_DATE_ET, 0, 0);
  let index = 0;
  while (monday <= SEASON_END_DATE_ET) {
    const days: Matchday[] = [];
    for (let i = 0; i < 5; i++) {
      const d = addDays(monday, i);
      if (index === 0 && d < LAUNCH_DATE_ET) continue;
      if (isTradingDay(d)) days.push({ date: d, closeAt: closeOf(d), halfDay: isHalfDay(d) });
    }
    if (days.length) {
      const first = days[0]!;
      const last = days[days.length - 1]!;
      const id = `GW${index}`;
      out.push({
        id,
        index,
        season: 0,
        preseason: index === 0,
        label: `${id} · ${fmtDay(first.date)} – ${fmtDay(last.date)}`,
        tradingDays: days,
        openAt: index === 0 ? etToUtc(LAUNCH_DATE_ET, 0, 0) : openOf(first.date),
        buyFrom: prevCut,
        cutAt: last.closeAt,
      });
      prevCut = last.closeAt;
      index++;
    }
    monday = addDays(monday, 7);
  }
  return out;
}

export const SEASON: readonly Gameweek[] = buildSeason();
export const LAUNCH_AT = SEASON[0]!.buyFrom;

export function gameweekById(id: string): Gameweek {
  const g = SEASON.find((x) => x.id === id);
  if (!g) throw new ClubsError('unknown_gameweek', `unknown gameweek ${id}`);
  return g;
}

/** The gameweek whose buy window contains t, or null before launch / after the season. */
export function gameweekForBuy(t: number): Gameweek | null {
  return SEASON.find((g) => t > g.buyFrom && t <= g.cutAt) ?? null;
}

/** The gameweek in play at time t (same as gameweekForBuy; after a cut, the next gameweek is current). */
export const currentGameweek = (t: number) => gameweekForBuy(t);

/** Last gameweek whose cut is <= t (the one to settle). */
export function lastSettledGameweek(t: number): Gameweek | null {
  let g: Gameweek | null = null;
  for (const x of SEASON) if (x.cutAt <= t) g = x;
  return g;
}

/** Latest matchday close inside the gameweek at or before t (null if the first close hasn't happened). */
export function latestMatchdayCut(gw: Gameweek, t: number): Matchday | null {
  let m: Matchday | null = null;
  for (const d of gw.tradingDays) if (d.closeAt <= t) m = d;
  return m;
}

export function matchdayOf(date: string): { gw: Gameweek; day: Matchday } {
  for (const gw of SEASON) {
    const day = gw.tradingDays.find((d) => d.date === date);
    if (day) return { gw, day };
  }
  throw new ClubsError('not_matchday', `${date} is not a matchday in the season`);
}

/** Seconds until the next cut (for "Matchday closes in ..." copy). */
export function nextCut(t: number): { gw: Gameweek; day: Matchday } | null {
  for (const gw of SEASON) for (const day of gw.tradingDays) if (day.closeAt > t) return { gw, day };
  return null;
}

export const daysBetween = (a: number, b: number) => (b - a) / DAY;
