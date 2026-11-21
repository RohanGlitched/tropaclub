import type { KitPattern } from './stadium';

export const PALETTE = {
  midnight: '#121037',
  marigold: '#FFC531',
  chalk: '#F4F1E8',
  pitch: '#12A874',
  flare: '#FF5C4D',
  sky: '#8AB8FF',
  line: '#232064',
  label: '#A9ABD9',
} as const;

export interface Kit {
  primary: string;
  secondary: string;
  pattern: KitPattern;
}

const P = PALETTE;
const CURATED: Record<string, Kit> = {
  NVDAc: { primary: P.pitch, secondary: P.chalk, pattern: 'hoops' },
  GOOGLc: { primary: P.sky, secondary: P.flare, pattern: 'halves' },
  SPCXc: { primary: P.chalk, secondary: P.sky, pattern: 'sash' },
  METAc: { primary: P.sky, secondary: P.chalk, pattern: 'chevron' },
  TSLAc: { primary: P.flare, secondary: P.chalk, pattern: 'sash' },
  MSTRc: { primary: P.flare, secondary: P.sky, pattern: 'hoops' },
  ANTc: { primary: P.chalk, secondary: P.flare, pattern: 'halves' },
};
const PRIMARIES = [P.pitch, P.flare, P.sky, P.chalk];
const PATTERNS: KitPattern[] = ['hoops', 'halves', 'sash', 'chevron', 'solid'];

function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function kitFor(symbol: string): Kit {
  const c = CURATED[symbol];
  if (c) return c;
  const h = strHash(symbol);
  const primary = PRIMARIES[h % 4];
  const rest = PRIMARIES.filter((x) => x !== primary);
  return { primary, secondary: rest[(h >>> 4) % 3], pattern: PATTERNS[(h >>> 8) % 5] };
}

// Short display names. The indexer publishes full legal names ("NVIDIA Corporation"); every screen
// shows the short one ("NVIDIA"). Odd cases are listed by ticker; the rest lose their legal suffixes.
const SHORT: Record<string, string> = {
  GOOGLc: 'Alphabet', SPCXc: 'SpaceX', ANTc: 'Anthropic', METAc: 'Meta', AAPLc: 'Apple', AMZNc: 'Amazon', TSLAc: 'Tesla',
  MSFTc: 'Microsoft', MSTRc: 'Strategy', SNDKc: 'SanDisk', NVDAc: 'NVIDIA', TTWOc: 'Take-Two', CRCLc: 'Circle', LULUc: 'Lululemon',
  AMDc: 'AMD', BUDc: 'AB InBev', DJTc: 'Trump Media', KOc: 'Coca-Cola', 'BRK.Bc': 'Berkshire Hathaway', BMNRc: 'BitMine', ASTSc: 'AST SpaceMobile',
};
const SUFFIX = /(?:,?\s+(?:the|corporation|corp|incorporated|inc|holdings|holding|group|plc|ltd|limited|llc|pbc|company|co|n\.?v|s\.?a|sa\/nv|a\/s|se|ag|class\s+[a-c]|common\s+stock|ordinary\s+shares|adr)\.?|\s*&\s*co\.?|[\s.,;:&-]+)$/i;

/** "NVIDIA Corporation" -> "NVIDIA". Pass the ticker when there is one, for the override list. */
export function shortName(name: string, symbol?: string): string {
  if (symbol && SHORT[symbol]) return SHORT[symbol];
  let n = name.trim().replace(/^the\s+/i, '');
  for (let i = 0; i < 8; i++) {
    const next = n.replace(SUFFIX, '');
    if (next === n || next.length < 2) break;
    n = next;
  }
  return n || name.trim();
}

/** "NVIDIA" -> "NVIDIA FC". A nickname for the token's holders, not the company. */
export const clubName = (name: string, symbol?: string) => `${shortName(name, symbol)} FC`;
export const groundPath = (symbol: string) => `/ground/${encodeURIComponent(symbol)}`;
