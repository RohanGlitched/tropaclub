/**
 * Crest seeds and generated club names. The web app draws the felt-pennant crest from `crestSeed`
 * (colours, pattern, emblem); crestFromSeed() gives it a deterministic recipe.
 */
import { fnv1a, randomHex, seededRandom } from './util';

export const CREST_COLOURS = ['#12A874', '#FF5C4D', '#8AB8FF', '#F4F1E8', '#FFC531', '#121037'] as const;
export const CREST_PATTERNS = ['hoops', 'halves', 'sash', 'chevron', 'solid', 'quarters'] as const;
export const CREST_EMBLEMS = ['star', 'bolt', 'wave', 'peak', 'sun', 'leaf', 'anchor', 'crown'] as const;

export interface CrestRecipe {
  primary: string;
  secondary: string;
  pattern: (typeof CREST_PATTERNS)[number];
  emblem: (typeof CREST_EMBLEMS)[number];
  stripes: number;
}

export const newCrestSeed = () => randomHex(8);

export function crestFromSeed(seed: string): CrestRecipe {
  const rnd = seededRandom(seed);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
  const primary = pick(CREST_COLOURS);
  const secondary = pick(CREST_COLOURS.filter((c) => c !== primary));
  return { primary, secondary, pattern: pick(CREST_PATTERNS), emblem: pick(CREST_EMBLEMS), stripes: 1 + Math.floor(rnd() * 3) };
}

const NOUNS = ['Rovers', 'Wanderers', 'United', 'Athletic', 'Harriers', 'Rangers', 'Albion', 'Dynamo', 'Olympic', 'Corinthians', 'Town', 'Comets'];
const REGION_SHORT: Record<string, string[]> = {
  'Latin America': ['Andes', 'Pampas', 'Caribe', 'Amazonia', 'Sierra'],
  'North America': ['Northern', 'Great Lakes', 'Prairie'],
  Europe: ['Continental', 'Atlantic', 'Baltic', 'Alpine', 'Danube'],
  'Middle East & North Africa': ['Gulf', 'Levant', 'Maghreb', 'Oasis'],
  'Sub-Saharan Africa': ['Savanna', 'Sahel', 'Rift', 'Cape', 'Lagoon'],
  'South Asia': ['Monsoon', 'Deccan', 'Himalaya'],
  'Southeast Asia': ['Archipelago', 'Mekong', 'Equator', 'Strait'],
  'East Asia': ['Pacific Rim', 'Eastern', 'Jade'],
  Oceania: ['Southern Cross', 'Reef', 'Tasman'],
  'Central Asia': ['Silk Road', 'Steppe', 'Caucasus'],
  Global: ['Meridian', 'Worldwide', 'Open Seas', 'Longitude'],
};

/** "Andes Rovers" style name from a region label and seed. Never contains a country. */
export function pickupClubName(region: string, seed: string): string {
  const h = fnv1a(seed);
  const shorts = REGION_SHORT[region] ?? REGION_SHORT.Global!;
  return `${shorts[h % shorts.length]} ${NOUNS[(h >>> 8) % NOUNS.length]}`;
}

export const stockClubId = (symbol: string) => `stock-${symbol.toLowerCase()}`;
/** "NVIDIA" -> "NVIDIA FC" (same as web/lib/clubs.ts clubName). */
export const stockClubName = (name: string) => `${name} FC`;
