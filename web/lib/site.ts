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
export const PLAY_USD = 5;
/** The one sentence used wherever $5 or $10 is mentioned as a rule. */
export const RULE_LINE = '$10 a week is the habit; $5 or more in a gameweek counts as played.';
/** The indexer recounts at :17 past 00, 06, 12 and 18 UTC. */
export const COUNT_EVERY = 'every 6 hours';
export const X_FOLLOW_URL = 'https://x.com/intent/follow?screen_name=tropaclubxyz';

export const CHANGELOG: { date: string; text: string }[] = [
  { date: '22 Nov 2026', text: 'The Ground and The Attendance open, read-only. Matchday tickets for every wallet with a seat.' },
  { date: '21 Nov 2026', text: 'First full count: 21.8 million transfers of 90 stock tokens replayed, Aug 12 to Nov 21.' },
];
export const UPCOMING: { date: string; text: string }[] = [
  { date: 'Tue 24 Nov', text: 'Clubs open: private clubs, pick-up clubs, the Bench and the first Matchday.' },
  { date: 'Thu 26 Nov', text: 'Cost-basis statement for any holder, adjusted for splits and stock dividends.' },
  { date: 'Mon 30 Nov', text: 'Fixtures between clubs.' },
];
