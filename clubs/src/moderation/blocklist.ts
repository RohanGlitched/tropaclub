/**
 * Server-only: the words a club name or nickname may not contain. This file is never imported by
 * client code (the clubs package is server-only, and the web app reaches it through
 * lib/server/*). Entries are compared after names.ts folds case, accents, look-alike letters,
 * digits-for-letters and repeated letters, so each entry is written once, plainly.
 */

/** Names that would pass a club off as run by Base, Coinbase or us. Matched as whole words. */
export const RESERVED_WORDS: readonly string[] = ['base', 'coinbase', 'official', 'admin', 'support', 'tropa', 'tropaclub', 'moderator', 'staff'];

/** Reserved strings that are refused even inside a longer word ("CoinbaseFC", "TropaHQ"). */
export const RESERVED_INSIDE: readonly string[] = ['coinbase', 'tropa', 'official'];

/**
 * A small list of slurs. Entries of six letters or more are refused anywhere inside a name; short
 * ones are refused as whole words and at the start or end of a word ("fagclub", "clubfag"), except
 * for the real words in AFFIX_ALLOW_* below ("spicy" and "Scunthorpe" stay fine).
 */
export const SLURS: readonly string[] = [
  'nigger',
  'nigga',
  'faggot',
  'fag',
  'retard',
  'retarded',
  'kike',
  'spic',
  'chink',
  'gook',
  'wetback',
  'tranny',
  'dyke',
  'coon',
  'paki',
  'raghead',
  'towelhead',
  'beaner',
  'cripple',
  'whore',
  'slut',
  'cunt',
  'rapist',
  'nazi',
  'hitler',
  'kkk',
  'heil',
  'macaco',
  'viado',
  'maricon',
  'sudaca',
];

/** Real words and names that start with a short entry above. A word starting with one of these is not refused. */
export const AFFIX_ALLOW_PREFIX: readonly string[] = [
  'spice', 'spicy', 'spici', 'spicu', 'spickandspan',
  'pakistan',
  'fagin', 'fagan', 'fagun', 'fagne', 'fagi',
  'nazir', 'nazim', 'nazia', 'nazih',
  'heilbronn', 'heilman',
  'niggard',
  'coonhound',
];

/** Real words that end with a short entry above ("raccoon", "tycoon", "Van Dyke" written as one word). */
export const AFFIX_ALLOW_SUFFIX: readonly string[] = ['raccoon', 'racoon', 'cocoon', 'tycoon', 'vandyke'];
