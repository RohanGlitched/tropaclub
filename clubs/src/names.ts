/**
 * Club names and nicknames are shown in public (the /league founding list, tables, Matchday cards),
 * so they are cleaned before they are stored and checked again before they are listed.
 *
 *   cleanName: NFKC, then bidi controls, zero-width and other invisible format characters and
 *              control characters removed, stacked combining marks trimmed, spaces collapsed.
 *   nameProblem: what is wrong with a cleaned name, or null. Reserved words (Base, Coinbase,
 *              official, admin, support, team, tropa) and the slur list in moderation/blocklist.ts
 *              are matched after folding case, accents, look-alike Cyrillic and Greek letters,
 *              digits used as letters and stretched letters; dots, dashes and underscores between letters
 *              are folded out and runs of single letters ("n i g g a", "b.a.s.e") are merged first.
 *   isListedClub: a private or pick-up club is listed in public only once it has two members or a
 *              playing member (a qualifying buy), its name passes, and it is not hidden.
 */
import { AFFIX_ALLOW_PREFIX, AFFIX_ALLOW_SUFFIX, RESERVED_INSIDE, RESERVED_WORDS, SLURS } from './moderation/blocklist';
import type { ClubDoc } from './types';

export const MAX_CLUB_NAME = 40;

// Cc: control characters. Cf: format characters, which include every bidi control (U+202A-202E,
// U+2066-2069, U+200E/F, U+061C), the zero-width ones (U+200B-200D, U+2060, U+FEFF, U+180E) and the
// invisible tag characters. Zl/Zp: line and paragraph separators. U+115F, U+1160, U+3164 and
// U+FFA0 are Hangul fillers that render as blanks, U+2800 is the blank braille pattern, and
// U+FE00-FE0F are variation selectors.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u{115F}\u{1160}\u{3164}\u{FFA0}\u{2800}\u{FE00}-\u{FE0F}]/gu;

/** NFKC, invisible and control characters removed, at most two combining marks per letter, spaces collapsed. */
export function cleanName(raw: string): string {
  return String(raw ?? '')
    .normalize('NFKC')
    .replace(/\s/g, ' ')
    .replace(INVISIBLE, '')
    .replace(/(\p{M}{2})\p{M}+/gu, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Length in characters (code points), not UTF-16 units. */
export const nameLength = (s: string) => [...s].length;

/** Cut to at most `max` characters without splitting a character. */
export const capName = (s: string, max = MAX_CLUB_NAME) => {
  const cps = [...s];
  return cps.length <= max ? s : cps.slice(0, max).join('').trimEnd();
};

const LOOKALIKE: Record<string, string> = {
  // Cyrillic
  'а': 'a', 'в': 'b', 'е': 'e', 'ё': 'e', 'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o', 'р': 'p', 'с': 'c',
  'т': 't', 'у': 'y', 'х': 'x', 'і': 'i', 'ї': 'i', 'ј': 'j', 'ѕ': 's', 'ԁ': 'd', 'ԛ': 'q', 'ԝ': 'w',
  // Greek
  'α': 'a', 'β': 'b', 'ε': 'e', 'η': 'n', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'ο': 'o', 'ρ': 'p', 'τ': 't',
  'υ': 'u', 'χ': 'x', 'ω': 'w', 'ς': 's', 'σ': 's',
  // Latin look-alikes
  'ɡ': 'g', 'ı': 'i',
  // digits and symbols used as letters
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g', '@': 'a', $: 's', '!': 'i', '|': 'i', '+': 't', '\u{20AC}': 'e',
};

/** Characters people put between the letters of a word to hide it: "f.a.g", "k-k-k", "n_i_g_g_a". */
const JOINERS = /[.\-_*'’`·•~^,:;]+/g;

/**
 * Lowercase letters only, accents and look-alikes folded. Returns the words to test and the whole
 * name squashed together. The words are: the plain words; each space-separated token with joiners
 * ("." "-" "_" ...) removed; and runs of single-letter words merged ("n i g g a", "b.a.s.e").
 */
function fold(s: string): { words: string[]; squashed: string } {
  const base = s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  let out = '';
  for (const ch of base) out += LOOKALIKE[ch] ?? ch;
  const plain = out.split(/[^a-z]+/).filter(Boolean);
  const words = new Set<string>(plain);
  for (const tok of out.split(/\s+/)) for (const w of tok.replace(JOINERS, '').split(/[^a-z]+/)) if (w) words.add(w);
  let run = '';
  for (const w of [...plain, '']) {
    if (w.length === 1) run += w;
    else {
      if (run.length > 1) words.add(run);
      run = '';
    }
  }
  return { words: [...words], squashed: plain.join('') };
}

/**
 * One list entry (lowercase a-z only) as a pattern: each run of a letter may be stretched, never
 * shortened ("nazi" matches "naazzi"; "coon" does not match "con", and "kkk" does not match "k").
 */
function pattern(entry: string, whole: boolean): RegExp {
  const runs = entry.replace(/[^a-z]/g, '').match(/([a-z])\1*/g) ?? [];
  const body = runs.map((r) => `${r[0]}{${r.length},}`).join('');
  return new RegExp(whole ? `^${body}s?$` : body);
}
const reservedWords = RESERVED_WORDS.map((w) => pattern(w, true));
const reservedInside = RESERVED_INSIDE.map((w) => pattern(w, false));
const slurWords = SLURS.map((w) => pattern(w, true));
const slurInside = SLURS.filter((w) => w.length >= 6).map((w) => pattern(w, false));
// Short entries (under 6 letters) are also refused at the start or end of a word ("fagclub",
// "clubfag"), except for the real words in AFFIX_ALLOW_*.
const shortSlurs = SLURS.filter((w) => w.length < 6).map((w) => {
  const body = pattern(w, false).source;
  return { w, start: new RegExp('^' + body), end: new RegExp(body + 's?$') };
});

function affixSlur(word: string): boolean {
  const noS = word.replace(/s$/, '');
  return shortSlurs.some(
    ({ w, start, end }) =>
      (start.test(word) && !AFFIX_ALLOW_PREFIX.some((a) => a.startsWith(w) && word.startsWith(a))) ||
      (end.test(word) && !AFFIX_ALLOW_SUFFIX.some((a) => a.endsWith(w) && noS.endsWith(a))),
  );
}

export type NameProblem = 'empty' | 'too_long' | 'reserved' | 'abusive' | 'link';

/** What is wrong with a name (cleaned first), or null. */
export function nameProblem(name: string, opts: { max?: number; min?: number } = {}): NameProblem | null {
  const n = cleanName(name);
  if (nameLength(n) < (opts.min ?? 1)) return 'empty';
  if (nameLength(n) > (opts.max ?? MAX_CLUB_NAME)) return 'too_long';
  if (/https?:|www\.|\.(com|xyz|io|gg|net|org|app|me)\b|@/i.test(n)) return 'link';
  const { words, squashed } = fold(n);
  const all = [...words, squashed];
  if (all.some((w) => slurWords.some((p) => p.test(w))) || words.some(affixSlur) || slurInside.some((p) => p.test(squashed))) return 'abusive';
  if (all.some((w) => reservedWords.some((p) => p.test(w))) || reservedInside.some((p) => p.test(squashed))) return 'reserved';
  return null;
}

/** The name as it may be shown in public: cleaned and capped. */
export const publicName = (name: string) => capName(cleanName(name));

/** Is this club shown on public lists (the founding list, tables)? Stock clubs always are. */
export function isListedClub(c: Pick<ClubDoc, 'kind' | 'name' | 'memberCount' | 'playingCount'> & { hidden?: boolean }): boolean {
  if (c.hidden === true) return false;
  if (c.kind === 'stock') return true;
  if (nameProblem(c.name) !== null) return false;
  return c.memberCount >= 2 || c.playingCount > 0;
}
