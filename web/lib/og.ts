// Versions in share-picture URLs. One URL means one picture, so each can be cached for a long time.
// The prefix is the picture design's version (h3 / c5): a new design is a new URL everywhere.
/** The count time, to the minute. */
export const homeOgVersion = (asOf: string) => `h3-${asOf.slice(0, 16)}`;
/** The count time plus the "Played" stamp and the honours tag, if the ticket carries them. */
export const ticketOgVersion = (asOf: string, stamp?: string | null, honours?: string | null) => `c5-${asOf.slice(0, 16)}${stamp ? `-${stamp}` : ''}${honours ? `-${honours}` : ''}`;
