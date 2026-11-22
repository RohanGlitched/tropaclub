import rules from './rules.json';
import { shortName } from './clubs';
export const SITE_URL = (process.env.SITE_URL || 'https://tropaclub.xyz').replace(/\/$/, '');
export const X_URL = 'https://x.com/tropaclubxyz';
export const DOCS_URL = 'https://docs.tropaclub.xyz';
export const BUILDER_CODE = 'bc_vdp89s9b';
/** Launch: when buying first opens. All "opens ..." copy uses this, never BUY_OPEN_AT. */
export const LAUNCH_AT = '2026-11-24T14:30:00.000Z';
/**
 * The moment the buy gate opens (ISO). BUY_OPEN_AT can move it (tests, a delayed launch); it never
 * changes the launch copy. To stop buying after launch, use BUY_PAUSED, not a far-future date.
 */
export const buyOpenAt = () => {
  const v = process.env.BUY_OPEN_AT;
  return v && !isNaN(Date.parse(v)) ? new Date(v).toISOString() : LAUNCH_AT;
};
/** The kill switch: BUY_PAUSED=1 refuses every quote and shows "Buying paused". Recording a buy already made still works. */
export const buyPaused = () => /^(1|true|yes|on)$/i.test(process.env.BUY_PAUSED ?? '');
export const PAUSED_MESSAGE = "Buying is paused for a few minutes while we check something. Your money hasn't moved.";
export const buyIsOpen = (now = Date.now()) => !buyPaused() && now >= Date.parse(buyOpenAt());
/** Where buying stands right now: server components pass this to the browser as a prop. */
export type BuyState = 'before' | 'open' | 'paused';
export const buyState = (now = Date.now()): BuyState => (buyPaused() ? 'paused' : now >= Date.parse(buyOpenAt()) ? 'open' : 'before');
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
/**
 * utcWhen with the year added whenever it is not `year` (the current UTC year by default), so a
 * date in another year is never ambiguous: "Thu Jan 1 2099, 00:00 UTC".
 */
export const utcWhenYear = (iso: string, year = new Date().getUTCFullYear()) => {
  const d = new Date(iso);
  if (d.getUTCFullYear() === year) return utcWhen(iso);
  return `${utcDay(iso)} ${d.getUTCFullYear()}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
};
/** The heading of the paused state, beside PAUSED_MESSAGE. */
export const PAUSED_TITLE = 'Buying paused';
/** The ticket's Caps line: "3.5 points (Caps) · rank #12". */
export const capsPointsLine = (c: { caps: number; rank: number }) => `${c.caps.toLocaleString('en-US', { maximumFractionDigits: 2 })} points (Caps) · rank #${c.rank.toLocaleString('en-US')}`;
/** The day buying opens, "Tue Nov 24" (UTC): the launch, whatever BUY_OPEN_AT says. */
export const OPENS = utcDay(LAUNCH_AT);
/** The moment buying opens, "Tue Nov 24, 14:30 UTC". Where the visitor's own time can be shown, use <OpensAt>. */
export const OPENS_UTC = utcWhen(LAUNCH_AT);
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
/** The club payday streak, as clubs/src/streaks.ts (paydayStreak) implements it. */
export const STREAK_RULE: string = rules.streakRule;
export const STREAK_SHORT: string = rules.streakShort;
/**
 * The ticket's "weeks in a row" best stat: the indexer's streakWeeks (consecutive ISO weeks with a net
 * increase in the wallet's balance of that token, from any source). Not the payday streak.
 */
export const WEEKLY_RUN_RULE: string = rules.weeklyRunRule;
export const REAL_FAN_LINE: string = rules.realFanLine;
/** The indexer recounts at :17 past 00, 06, 12 and 18 UTC. */
export const COUNT_EVERY = 'every 6 hours';
export const X_FOLLOW_URL = 'https://x.com/intent/follow?screen_name=tropaclubxyz';

/** Caps, the season scoreboard (clubs/src/caps.ts reads the same values). Cosmetic: no money, no tokens. */
export const CAPS_RULES = rules.caps;
/** "Caps are points on a scoreboard, not a currency: …" Once per page: under the Caps table, in the /about glossary, and in the docs. */
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

/** The public source code. */
export const REPO_URL = 'https://github.com/RohanGlitched/tropaclub';
/** Where the Builder Code is explained in the docs. */
export const BUILDER_CODE_DOCS = `${DOCS_URL}/buying-and-safety#attribution`;

/**
 * The person behind Tropa Club, shown in "Who builds this" on /about.
 * FILL IN BEFORE IT SHOWS: set `name` to the builder's real name and `email` to a real contact
 * address. While a field is null, nothing is rendered for it (never a placeholder or a made-up name).
 */
export const BUILDER: { name: string | null; email: string | null } = { name: null, email: null };

/**
 * Where a buy's money goes: the exact contracts. These copy buy/src/constants.ts (KYBER_ROUTER and
 * SLIPSTREAM_FACTORIES), so pages that never load wallet code can show them; test/site-facts.test.ts
 * fails if the two ever differ.
 */
export const BUY_ROUTER = '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5';
export const SLIPSTREAM_FACTORY_LIST = ['0x9CB220581b91b0C83223012FE69688b92aD07a76', '0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A'] as const;
/** The price guard in percent (buy/src/constants.ts GUARD_BPS / 100). */
export const GUARD_PCT = 1.5;
/** The amounts the buy box offers (components/buy/BuySheet.tsx PRESETS). */
export const BUY_AMOUNTS = [10, 25, 50] as const;
export const basescan = (address: string) => `https://basescan.org/address/${address}`;

/**
 * The sign-in message, as web/lib/server/session.ts newChallenge builds it (viem createSiweMessage).
 * SIWE_STATEMENT must match the statement there word for word; test/site-facts.test.ts checks it.
 */
export const SIWE_STATEMENT = 'Sign in to Tropa Club. This only proves the wallet is yours. It is free and moves no funds.';
export const SIWE_CHAIN_ID = 8453;
/**
 * The sign-in message with placeholders for the wallet, the one-time code and the times. `site`
 * defaults to the public address (client components cannot read SITE_URL); server pages pass SITE_URL.
 */
export function siwePreview(site = 'https://tropaclub.xyz'): string {
  const u = new URL(site);
  return [
    `${u.host} wants you to sign in with your Ethereum account:`,
    '<your wallet address>',
    '',
    SIWE_STATEMENT,
    '',
    `URI: ${u.origin}`,
    'Version: 1',
    `Chain ID: ${SIWE_CHAIN_ID}`,
    'Nonce: <a one-time random code>',
    'Issued At: <the time you tap Sign in>',
    'Expiration Time: <10 minutes later>',
  ].join('\n');
}
