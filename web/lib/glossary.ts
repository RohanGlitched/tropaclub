// The one place every <Term> reads its definition from. Short, plain and true to the code:
// rule numbers come from rules.json (through lib/site.ts), so the copy moves when a rule does.
// /about lists the site glossary (its GLOSSARY_ORDER); the rest are extra terms that pages use.
import { BUILDER_CODE, CAPS_COPY, CAPS_RULES, OPENS, PLAY_USD, REAL_FAN_USD, SCOUT_RULES, STREAK_SHORT, WEEKLY_RUN_RULE, utcWhen } from './site';
import rules from './rules.json';

const S1 = rules.season1;

export interface GlossaryEntry {
  /** The term as a heading would print it. */
  term: string;
  /** One or two plain sentences. No advice, no returns language. */
  def: string;
}

export const GLOSSARY = {
  'stock-token': {
    term: 'Stock token',
    def: 'A Coinbase token on Base that tracks a share price, like NVIDIA’s. It is not the share and gives no vote.',
  },
  ground: {
    term: 'Ground',
    def: 'A drawing of one stock token’s holders as a football stadium, like the NVIDIA ground. Every wallet holding the token is one seat.',
  },
  holders: {
    term: 'Holders',
    def: 'Every wallet holding any amount of a token. It is the number a block explorer such as Basescan calls “holders”.',
  },
  'real-fan': {
    term: 'Real holder (real fan)',
    def: `A wallet that holds $${REAL_FAN_USD} or more of the token, bought it itself, and belongs to a person, not a contract.`,
  },
  'ghost-seat': {
    term: 'Ghost seat',
    def: `A holder that is not a real holder: under $${REAL_FAN_USD} (dust), airdrop-only (it only ever received a giveaway), or a contract such as a pool. Drawn faint.`,
  },
  attendance: {
    term: 'Attendance',
    def: 'Real holders divided by all holders of a token, as a percent.',
  },
  ticket: {
    term: 'Ticket',
    def: 'A shareable card showing a real holder’s rank and best stat for one token. It shows no dollar amounts and is not an NFT.',
  },
  club: {
    term: 'Club',
    def: 'A group of friends who each buy about $10 of stock tokens a week from their own wallets. There is no shared pot, and Tropa Club takes no fee.',
  },
  'stock-club': {
    term: 'Open club',
    def: 'The open club for one stock token, like the NVIDIA open club. Anyone can join for free. Its members are people who joined there, not every holder in the ground, and it is ranked only on how many members buy.',
  },
  gameweek: {
    term: 'Gameweek (GW)',
    def: `One trading week, from the first US stock market session of the week to its last close. GW0 starts ${OPENS} and is a practice week.`,
  },
  bench: {
    term: 'Played and Bench',
    def: `Played: you bought $${PLAY_USD} or more through Tropa Club that gameweek. Bench: club members who have not bought yet this gameweek.`,
  },
  matchday: {
    term: 'Matchday card',
    def: 'Your club’s weekly card: who bought, who has not yet, and turnout. It updates after each US trading day.',
  },
  fixture: {
    term: 'Fixture',
    def: 'From week 1, your club is paired each week with a club of a similar size: 3 points if more of your club played than theirs. Returns decide nothing. Bragging rights only.',
  },
  caps: {
    term: 'Caps (season points)',
    def: `Season points: ${CAPS_RULES.played} for playing a gameweek, ${CAPS_RULES.heldD7} more if that buy is still held 7 days later, and ${CAPS_RULES.scout} for each credited friend (at most ${CAPS_RULES.scoutPerGw} a gameweek). At most ${CAPS_RULES.perGw} Caps a gameweek, never for the size of a buy. Season 1 adds a founder Cap (${CAPS_RULES.founder}, once) and up to ${S1.social.max} for social quests. ${CAPS_COPY}`,
  },
  'season-1': {
    term: 'Season 1',
    def: `The first Caps season: ${utcWhen(S1.startAt)} to ${utcWhen(S1.endAt)}, gameweeks ${S1.gameweeks.join(' and ')}. Its Caps count toward the planned $TROPA airdrop. $TROPA may never launch, and there is no guarantee it will have any value.`,
  },
  snapshot: {
    term: 'Snapshot',
    def: `The Caps table as it stands when Season 1 ends (${utcWhen(S1.endAt)}). If $TROPA launches, each wallet’s share of the Season 1 pool is worked out from it, in proportion to Caps.`,
  },
  provisional: {
    term: 'Provisional wallet',
    def: `A wallet first seen less than ${S1.provisionalHours} hours before its first verified buy, or one we could not date yet. Its Caps show on the table but are only decided at the snapshot.`,
  },
  'social-quest': {
    term: 'Social quest',
    def: `Follow, like and repost, or post on X for a few Season 1 Caps (at most ${S1.social.max} a season). Self-reported and spot-checked, and counted only once the wallet has a verified Season 1 buy.`,
  },
  scout: {
    term: 'Scouts',
    def: `Members who refer friends. You get credit when a friend’s first buy through Tropa Club is still held at $${SCOUT_RULES.holdUsd} or more on day 7. Each credit earns ${CAPS_RULES.scout} Caps.`,
  },
  // extra terms
  playing: {
    term: 'Played',
    def: `A member who bought $${PLAY_USD} or more of any stock token through Tropa Club inside this gameweek. Only members who played count toward a club’s result.`,
  },
  'payday-streak': {
    term: 'Payday streak',
    def: STREAK_SHORT,
  },
  'weekly-run': {
    term: 'Weeks in a row (ticket)',
    def: WEEKLY_RUN_RULE,
  },
  'pickup-club': {
    term: 'Pick-up club',
    def: 'A club for people without a group chat: we match you with others from your region. It starts when three can be put together and fills to five.',
  },
  nudge: {
    term: 'Nudge (call-up)',
    def: 'A one-tap WhatsApp or Telegram message to a club member who has not bought yet this week. The message is written for you, and you send it yourself.',
  },
  'builder-code': {
    term: 'Builder Code',
    def: `A public label (${BUILDER_CODE}) that Base uses to credit an app. Every buy made through Tropa Club carries it, so those buys can be counted. It does not change the price and adds no fee.`,
  },
  'share-equivalent': {
    term: 'Share equivalent',
    def: 'How many shares’ worth the tokens track, after splits and stock dividends. A token tracks a share; it is not a share.',
  },
  multiplier: {
    term: 'Multiplier',
    def: 'How many shares’ worth one token tracks. It starts at 1 and steps up with splits and stock dividends, so the token keeps tracking the share.',
  },
  'cost-basis': {
    term: 'Cost basis',
    def: 'What you paid, in dollars, for tokens you still hold or sold. The oldest tokens are used up first, and splits and stock dividends are adjusted for.',
  },
  mark: {
    term: 'Market price',
    def: 'The price used to value a token at one moment: the Chainlink price at that time when there is one, otherwise the recorded exchange price.',
  },
} satisfies Record<string, GlossaryEntry>;

export type TermId = keyof typeof GLOSSARY;
