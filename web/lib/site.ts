import rules from './rules.json';
export const SITE_URL = (process.env.SITE_URL || 'https://tropaclub.xyz').replace(/\/$/, '');
export const X_URL = 'https://x.com/tropaclubxyz';
export const DOCS_URL = 'https://docs.tropaclub.xyz';
export const BUILDER_CODE = 'bc_vdp89s9b';
export const TAGLINE = '$10 a week in stocks with your group chat.';
export const OPENS = 'Tue 24 Nov';
/** The moment buying opens (ISO). Server components read it and hand it to the browser as a prop. */
export const buyOpenAt = () => {
  const v = process.env.BUY_OPEN_AT;
  return v && !isNaN(Date.parse(v)) ? new Date(v).toISOString() : '2026-11-24T14:30:00.000Z';
};
export const buyIsOpen = (now = Date.now()) => now >= Date.parse(buyOpenAt());
/** The Playing line: buy this much in a gameweek and you played it. (A "real fan" seat in the index needs $10 held.) */
export const PLAY_USD: number = rules.playUsd;
/** The real-fan line in the index: $10 held. Not the play rule. */
export const REAL_FAN_USD: number = rules.realFanUsd;
/** What a buy can be paid in (matches the buy box). */
export const PAY_WITH: string = rules.payWith;
/** The one sentence used wherever $5 or $10 is mentioned as a rule. */
export const RULE_LINE = `$${rules.habitUsd} a week is the habit; $${rules.playUsd} or more in a gameweek counts as played.`;
/** Payday streak, as clubs/src/streaks.ts implements it. */
export const STREAK_RULE: string = rules.streakRule;
export const STREAK_SHORT: string = rules.streakShort;
export const REAL_FAN_LINE: string = rules.realFanLine;
/** The indexer recounts at :17 past 00, 06, 12 and 18 UTC. */
export const COUNT_EVERY = 'every 6 hours';
export const X_FOLLOW_URL = 'https://x.com/intent/follow?screen_name=tropaclubxyz';

/** Caps, the season scoreboard (clubs/src/caps.ts reads the same values). Cosmetic: no money, no tokens. */
export const CAPS_RULES = rules.caps;
/** "Caps are a scoreboard, not a currency. …" Shown under every Caps table and in the docs. */
export const CAPS_COPY: string = rules.caps.copy;
/** Scouts: credit for a friend who became a fan (clubs/src/scouts.ts). */
export const SCOUT_RULES = rules.scouts;
/** "No prizes, no cash, just your name on the board." */
export const SCOUT_COPY: string = rules.scouts.copy;
/** What a scout credit is, in one line. */
export const SCOUT_COUNTS = `A credit is a friend’s first verified buy through Tropa Club, made after they arrived through your link and still held at $${rules.scouts.holdUsd} or more seven days later. Sign-ups and joins earn nothing.`;
/** A scout's personal invite link. */
export const scoutUrl = (code: string) => `${SITE_URL}/j/${code}`;

export const CHANGELOG: { date: string; text: string }[] = [
  { date: '22 Nov 2026', text: 'Cost-basis statement live for any holder, adjusted for splits and stock dividends.' },
  { date: '22 Nov 2026', text: 'The Ground and The Attendance open, read-only. Matchday tickets for every wallet with a seat.' },
  { date: '21 Nov 2026', text: 'First full count: 21.8 million transfers of 90 stock tokens replayed, Aug 12 to Nov 21.' },
];
export const UPCOMING: { date: string; text: string }[] = [
  { date: 'Tue 24 Nov', text: 'Clubs open: private clubs, pick-up clubs, the Bench and the first Matchday.' },
  { date: 'Mon 30 Nov', text: 'Fixtures between clubs.' },
];

/** The not-affiliated line on ground pages, ticket pages and the ticket share picture. */
export function notAffiliated(company: string | string[]): string {
  const names = [...new Set(Array.isArray(company) ? company : [company])].filter(Boolean);
  const list = names.length <= 1 ? names[0] ?? 'the companies behind them' : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
  return `Stock tokens track the share price. Tropa Club isn't affiliated with or endorsed by ${list}.`;
}
