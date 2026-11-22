/**
 * Server-only: the words a club name or nickname may not contain. This file is never imported by
 * client code (the clubs package is server-only, and the web app reaches it through
 * lib/server/*). Entries are compared after names.ts folds case, accents, look-alike letters,
 * digits-for-letters and repeated letters, so each entry is written once, plainly.
 */

/** Names that would pass a club off as run by Base, Coinbase or us. Matched as whole words. */
export const RESERVED_WORDS: readonly string[] = ['base', 'coinbase', 'official', 'admin', 'support', 'team', 'tropa', 'tropaclub', 'moderator', 'staff'];

/** Reserved strings that are refused even inside a longer word ("CoinbaseFC", "TropaHQ"). */
export const RESERVED_INSIDE: readonly string[] = ['coinbase', 'tropa', 'official'];

/**
 * A small list of slurs. Short ones are matched as whole words only (so "spicy" and "Scunthorpe"
 * stay fine); entries of six letters or more are also refused inside a longer word.
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
