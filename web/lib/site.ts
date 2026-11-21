export const SITE_URL = (process.env.SITE_URL || 'https://tropaclub.xyz').replace(/\/$/, '');
export const X_URL = 'https://x.com/tropaclubxyz';
export const DOCS_URL = 'https://docs.tropaclub.xyz';
export const BUILDER_CODE = 'bc_vdp89s9b';
export const TAGLINE = '$10 a week in stocks with your group chat.';
export const OPENS = 'Tue 24 Nov';

export const CHANGELOG: { date: string; text: string }[] = [
  { date: '22 Nov 2026', text: 'The Ground and The Attendance open, read-only. Matchday tickets for every wallet with a seat.' },
  { date: '21 Nov 2026', text: 'First full count: 21.8 million transfers of 90 stock tokens replayed, Aug 12 to Nov 21.' },
];
export const UPCOMING: { date: string; text: string }[] = [
  { date: 'Tue 24 Nov', text: 'Clubs open: private clubs, pick-up clubs, the Bench and the first Matchday.' },
  { date: 'Thu 26 Nov', text: 'Cost-basis statement for any holder, adjusted for splits and stock dividends.' },
  { date: 'Mon 30 Nov', text: 'Fixtures between clubs.' },
];
