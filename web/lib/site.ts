import rules from './rules.json';
import { shortName } from './clubs';
export const SITE_URL = (process.env.SITE_URL || 'https://tropaclub.xyz').replace(/\/$/, '');
export const X_URL = 'https://x.com/tropaclubxyz';
export const DOCS_URL = 'https://docs.tropaclub.xyz';
export const BUILDER_CODE = 'bc_vdp89s9b';
/** The moment buying opens (ISO). Server components read it and hand it to the browser as a prop. */
export const buyOpenAt = () => {
  const v = process.env.BUY_OPEN_AT;
  return v && !isNaN(Date.parse(v)) ? new Date(v).toISOString() : '2026-11-24T14:30:00.000Z';
};
export const buyIsOpen = (now = Date.now()) => now >= Date.parse(buyOpenAt());
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Tue Nov 24" for an ISO time, in UTC. */
export const utcDay = (iso: string) => {
  const d = new Date(iso);
  return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
};
/** "Tue Nov 24, 14:30 UTC" for an ISO time. */
export const utcWhen = (iso: string) => {
  const d = new Date(iso);
  return `${utcDay(iso)}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
};
/** The day buying opens, "Tue Nov 24" (UTC). */
export const OPENS = utcDay(buyOpenAt());
/** The moment buying opens, "Tue Nov 24, 14:30 UTC". Where the visitor's own time can be shown, use <OpensAt>. */
export const OPENS_UTC = utcWhen(buyOpenAt());
/** Who cannot buy, in one line. Used wherever buying or clubs are offered. */
export const REGION_LINE = 'Not available to US persons or in sanctioned regions.';
/** The product in one line: the footer and page descriptions. */
export const TAGLINE = 'See who really holds each stock token, and buy about $10 a week with your group chat, each from your own wallet.';
/** The two halves of the product, as the home page and How it works introduce them. */
export const TWO_THINGS = [
  {
    title: 'Count the real holders',
    text: `Tropa Club counts who really holds each Coinbase stock token on Base: $${rules.realFanUsd} or more, bought it themselves, and a person’s wallet, not a contract. Checking any wallet is free, and nothing needs connecting.`,
  },
  {
    title: 'Clubs for your group chat',
    text: 'Friends each buy about $10 of stock tokens a week from their own wallets. Tropa Club shows who bought, keeps your streaks and keeps a cost-basis record. There is no shared pot and no fee.',
  },
] as const;
/** The played line: buy this much through Tropa Club in a gameweek and you played it. (A real fan in the index needs $10 held.) */
export const PLAY_USD: number = rules.playUsd;
/** The real-fan line in the index: $10 held. Not the play rule. */
export const REAL_FAN_USD: number = rules.realFanUsd;
/** What a buy can be paid in (matches the buy box). */
export const PAY_WITH: string = rules.payWith;
/** The one sentence used wherever $5 or $10 is mentioned as a rule. */
/** About $10 a week is the habit (not a rule). */
export const HABIT_USD: number = rules.habitUsd;
export const RULE_LINE = `About $${rules.habitUsd} a week is the habit. Buying $${rules.playUsd} or more through Tropa Club in a gameweek counts as played.`;
/** The buying streak, as clubs/src/streaks.ts implements it. */
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
/** Scouts: credit for a friend whose first buy is still held a week later (clubs/src/scouts.ts). */
export const SCOUT_RULES = rules.scouts;
/** "No prizes, no cash, just your name on the board." */
export const SCOUT_COPY: string = rules.scouts.copy;
/** What a scout credit is, in one line. */
export const SCOUT_COUNTS = `A credit is a friend’s first buy through Tropa Club, made after they arrived through your link, and still held at $${rules.scouts.holdUsd} or more on day 7. Sign-ups and joins earn nothing.`;
/** A scout's personal invite link. */
export const scoutUrl = (code: string) => `${SITE_URL}/j/${code}`;

/** How a weekly fixture is decided, in plain words, as clubs/src/fixtures.ts settles it: by turnout. */
export const FIXTURE_RULE: string = rules.fixtureRule;
export const FIXTURE_SHORT: string = rules.fixtureShort;

export const CHANGELOG: { date: string; text: string }[] = [
  { date: '22 Nov 2026', text: 'Cost-basis statement live for any holder, adjusted for splits and stock dividends.' },
  { date: '22 Nov 2026', text: 'Grounds and stock rankings open, read-only. A shareable ticket for every real holder.' },
  { date: '21 Nov 2026', text: 'First full count: 21.8 million transfers of 90 stock tokens replayed, Aug 12 to Nov 21.' },
];
export const UPCOMING: { date: string; text: string }[] = [
  { date: OPENS, text: `Clubs open: private clubs, pick-up clubs and the first weekly Matchday card. Buying opens at ${OPENS_UTC.split(', ')[1]}.` },
  { date: 'Mon Nov 30', text: 'Weekly pairings (fixtures) between clubs of a similar size start.' },
];

/** "NVIDIA ground": the per-stock page and its stadium drawing. "Club" is kept for groups of people. */
export const groundName = (name: string, symbol?: string) => `${shortName(name, symbol)} ground`;
/** "NVIDIA open club": the open club for one stock, which anyone can join for free. */
export const openClubName = (name: string, symbol?: string) => `${shortName(name, symbol)} open club`;

/** The not-affiliated line on ground pages, ticket pages and the ticket share picture. */
export function notAffiliated(company: string | string[]): string {
  const names = [...new Set(Array.isArray(company) ? company : [company])].filter(Boolean);
  const list = names.length <= 1 ? names[0] ?? 'the companies behind them' : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
  return `Stock tokens track the share price. Tropa Club isn't affiliated with or endorsed by ${list}.`;
}
