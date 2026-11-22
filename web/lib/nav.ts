// Navigation data shared by the header, the stadium map, quick jump, the bottom bar and the
// breadcrumbs. Pure: no React, no server code, safe on both sides.
import { DOCS_URL } from './site';
import { shortAddr } from './format';
import { shortName } from './clubs';

export type Section = 'home' | 'attendance' | 'ground' | 'clubs' | 'league' | 'stats' | 'statement' | 'about' | 'docs';

/** A stock ground in its compact form, as the layout hands it to the browser: [symbol, short name]. */
export type JumpToken = [symbol: string, name: string];
export const jumpTokens = (tokens: { symbol: string; name: string }[]): JumpToken[] => tokens.map((t) => [t.symbol, shortName(t.name, t.symbol)]);

/** Which part of the site a path belongs to. Tickets live under Grounds, club pages under Clubs. */
export function sectionOf(pathname: string | null | undefined): Section | null {
  const p = (pathname || '/').split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  if (p === '/') return 'home';
  if (p === '/attendance') return 'attendance';
  if (p.startsWith('/ground/') || p.startsWith('/ticket/')) return 'ground';
  if (p === '/clubs' || p.startsWith('/club/') || p.startsWith('/join/') || p.startsWith('/j/')) return 'clubs';
  if (p === '/league') return 'league';
  if (p === '/stats') return 'stats';
  if (p.startsWith('/statement/')) return 'statement';
  if (p === '/about') return 'about';
  return null;
}

/** The stands of the stadium map. Plain name first, football flavour second. */
export interface Stand {
  id: Section;
  label: string;
  /** The second line, printed under the name. */
  sub: string;
  /** The football name of the stand (small caps). */
  stand: string;
  /** One plain line, shown on hover or focus. */
  desc: string;
}

export function standsFor(opts: { grounds: number; wallet: string | null }): Stand[] {
  const n = opts.grounds || 90;
  return [
    { id: 'home', label: 'Home', sub: 'Entrance', stand: 'Main gate', desc: 'The front page: what Tropa Club does, the biggest ground, and how a club works.' },
    { id: 'ground', label: 'Grounds', sub: 'See who really holds a stock token', stand: 'South Stand', desc: 'See one stock token’s holders drawn as a stadium, then paste a wallet to check its rank and ticket.' },
    { id: 'attendance', label: 'Stock rankings', sub: `Real holders of all ${n} stock tokens`, stand: 'North Stand', desc: `All ${n} stock tokens in one table, ranked by how many real holders they have.` },
    { id: 'clubs', label: 'Clubs', sub: 'Start or join a club', stand: 'Clubhouse End', desc: 'Start a club with your group chat, join with an invite, or get matched into a pick-up club.' },
    { id: 'league', label: 'League', sub: 'Club scores and weekly rankings', stand: 'Away End', desc: 'Club rankings, open club rankings, Caps (points) and Scouts (referrers).' },
    { id: 'stats', label: 'Stats', sub: 'Numbers on Tropa Club’s own use', stand: 'Scoreboard', desc: 'How many people have bought through Tropa Club and kept holding, counted from public Base records.' },
    {
      id: 'statement',
      label: 'Statement',
      sub: 'Your cost basis',
      stand: 'Programme stall',
      desc: opts.wallet ? `What ${shortAddr(opts.wallet)}, the wallet you signed in with, paid for its stock tokens and what they are worth now.` : 'Paste a wallet to see what it paid for its stock tokens and what they are worth now.',
    },
    { id: 'about', label: 'How it works', sub: 'The two things Tropa Club does', stand: 'Information', desc: 'How real holders are counted, how clubs work, and the rules we keep: no advice, never ranked by size.' },
    { id: 'docs', label: 'Docs', sub: 'For builders', stand: 'Press box', desc: 'Opens docs.tropaclub.xyz: the data feed, the scoring rules and notes for partners.' },
  ];
}

/** Arrow-key moves on the plan. The topology is the same in landscape and portrait. */
export const STAND_MOVES: Record<Section, Partial<Record<'up' | 'down' | 'left' | 'right', Section>>> = {
  stats: { right: 'attendance', down: 'clubs' },
  attendance: { left: 'stats', right: 'statement', down: 'ground' },
  statement: { left: 'attendance', down: 'league' },
  clubs: { up: 'stats', down: 'about', right: 'league' },
  league: { up: 'statement', down: 'docs', left: 'clubs' },
  about: { up: 'clubs', right: 'ground', down: 'home' },
  ground: { up: 'attendance', left: 'about', right: 'docs', down: 'home' },
  docs: { up: 'league', left: 'ground', down: 'home' },
  home: { up: 'ground', left: 'about', right: 'docs' },
};

export function hrefFor(id: Section, ground: string, wallet: string | null): string | null {
  switch (id) {
    case 'home': return '/';
    case 'ground': return ground;
    case 'attendance': return '/attendance';
    case 'clubs': return '/clubs';
    case 'league': return '/league';
    case 'stats': return '/stats';
    case 'statement': return wallet ? `/statement/${wallet}` : null;
    case 'about': return '/about';
    case 'docs': return DOCS_URL;
  }
}

/** Pages quick jump can open. `keys` are extra words people type. */
export interface PageEntry { label: string; sub: string; href: string; keys: string; ext?: boolean }

export function pagesFor(ground: string, groundName: string): PageEntry[] {
  return [
    { label: 'Home', sub: 'Entrance', href: '/', keys: 'start front' },
    { label: 'Check a wallet', sub: 'Paste any address. See its rank. Nothing to sign.', href: '/#find', keys: 'ticket wallet seat search check find' },
    { label: 'Stock rankings', sub: 'Real holders of every stock token, ranked', href: '/attendance', keys: 'attendance table holders fans league stocks rankings' },
    { label: 'Grounds', sub: `The ${groundName} ground, the biggest`, href: ground, keys: 'ground stadium seating plan seats' },
    { label: 'Clubs', sub: 'Start or join a club', href: '/clubs', keys: 'group chat friends' },
    { label: 'Start a club', sub: 'Name it, get an invite link', href: '/clubs#start', keys: 'start create new club found' },
    { label: 'Join with an invite', sub: 'Paste a club invite code', href: '/clubs#join', keys: 'invite code join' },
    { label: 'Get a pick-up club', sub: 'Be matched with others from your region', href: '/clubs#join', keys: 'pickup pick up match solo strangers' },
    { label: 'Club rankings', sub: 'Club scores and weekly rankings', href: '/league', keys: 'league standings fixtures table' },
    { label: 'Open club rankings', sub: 'Open clubs, ranked on how many members buy', href: '/league#supporters', keys: 'supporters stock clubs open' },
    { label: 'Caps', sub: 'Your points for buying and holding', href: '/league?tab=caps', keys: 'caps points appearances leaderboard' },
    { label: 'Top referrers (Scouts)', sub: 'Friends whose first buy was still held at day 7', href: '/league?tab=scouts', keys: 'scouts referrals invite leaderboard' },
    { label: 'Stats', sub: 'Numbers on Tropa Club’s own use', href: '/stats', keys: 'numbers builder code metrics retention' },
    { label: 'How it works', sub: 'The two things Tropa Club does', href: '/about', keys: 'about rules faq' },
    { label: 'Data method', sub: 'How real holders are counted', href: '/about#method', keys: 'method count ghosts dust farmer' },
    { label: 'Free JSON feed', sub: 'The table as a public file', href: '/attendance#feed', keys: 'api json data feed' },
    { label: 'Privacy', sub: 'What is kept, and what is not', href: '/about#privacy', keys: 'privacy cookies data' },
    { label: 'Changelog', sub: 'What changed, and what is next', href: '/about#log', keys: 'changelog news updates' },
    { label: 'Docs', sub: 'For builders', href: DOCS_URL, keys: 'docs developers api builders', ext: true },
    { label: 'Scoring rules', sub: 'Gameweeks, fixtures, Caps, Scouts', href: `${DOCS_URL}/scoring-and-seasons`, keys: 'rules scoring gameweek matchday', ext: true },
  ];
}

/** A name to show for a path in "Recent". */
export function labelFor(pathname: string, tokens: JumpToken[]): string | null {
  const p = pathname.split(/[?#]/)[0];
  const fixed: Record<string, string> = { '/': 'Home', '/attendance': 'Stock rankings', '/clubs': 'Clubs', '/league': 'Club rankings', '/stats': 'Stats', '/about': 'How it works' };
  if (fixed[p]) return fixed[p];
  let m = p.match(/^\/ground\/([^/]+)$/);
  if (m) {
    const sym = decodeURIComponent(m[1]);
    const t = tokens.find(([s]) => s.toLowerCase() === sym.toLowerCase());
    return t ? `${t[1]} ground` : null;
  }
  m = p.match(/^\/(ticket|statement)\/(0x[0-9a-fA-F]{40})$/);
  if (m) return `${m[1] === 'ticket' ? 'Ticket' : 'Statement'} for ${shortAddr(m[2])}`;
  return null;
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9.]+/g, ' ').trim();

/** 0 = no match. Higher is better. */
export function scoreText(q: string, label: string, extra = ''): number {
  const n = norm(q);
  if (!n) return 0;
  const l = norm(label);
  if (l === n) return 100;
  if (l.startsWith(n)) return 80;
  if (l.split(' ').some((w) => w.startsWith(n))) return 60;
  // one or two letters only match the start of a word, or every page would match
  const short = n.length < 3;
  if (!short && l.includes(n)) return 40;
  const e = norm(extra);
  if (e.split(' ').some((w) => w.startsWith(n))) return 30;
  if (!short && n.split(' ').every((w) => `${l} ${e}`.includes(w))) return 20;
  return 0;
}

/** Ticker first ("nvda" finds NVDAc), then the company name. */
export function scoreToken(q: string, [symbol, name]: JumpToken): number {
  const n = norm(q).replace(/\s+/g, '');
  if (!n) return 0;
  const s = symbol.toLowerCase();
  const bare = s.replace(/c$/, '');
  if (n === s || n === bare) return 110;
  // equal scores keep the index order, which is biggest crowd first
  if (bare.startsWith(n)) return 90;
  return Math.max(0, scoreText(q, name, `${name} fc`) - 5);
}
