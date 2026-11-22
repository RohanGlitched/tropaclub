// Versions in share-picture URLs. One URL means one picture, so each can be cached for a long time.
/** The count time, to the minute. */
export const homeOgVersion = (asOf: string) => asOf.slice(0, 16);
/** The count time plus the "Played" stamp and the honours tag, if the ticket carries them. */
export const ticketOgVersion = (asOf: string, stamp?: string | null, honours?: string | null) => `${asOf.slice(0, 16)}${stamp ? `-${stamp}` : ''}${honours ? `-${honours}` : ''}`;
