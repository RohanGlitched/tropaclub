// Time helpers: ISO weeks (Monday start, UTC) and the US weekend gap (Fri 4pm ET close -> Sun 8pm ET reopen).

export const DAY = 86400;
export const weekIdx = (ts: number) => Math.floor((Math.floor(ts / DAY) + 3) / 7); // weeks since Mon 1969-12-29
export const weekStartTs = (w: number) => (w * 7 - 3) * DAY;
export const dayIdx = (ts: number) => Math.floor(ts / DAY);
export const hourIdx = (ts: number) => Math.floor(ts / 3600);

function nthSundayUtc(year: number, month: number, n: number): number {
  const first = Date.UTC(year, month, 1) / 1000;
  const dow = new Date(first * 1000).getUTCDay();
  const firstSun = first + ((7 - dow) % 7) * DAY;
  return firstSun + (n - 1) * 7 * DAY;
}
// US Eastern offset in seconds (negative). DST: 2nd Sunday of March 07:00 UTC -> 1st Sunday of November 06:00 UTC.
export function etOffset(ts: number): number {
  const y = new Date(ts * 1000).getUTCFullYear();
  const start = nthSundayUtc(y, 2, 2) + 7 * 3600;
  const end = nthSundayUtc(y, 10, 1) + 6 * 3600;
  return ts >= start && ts < end ? -4 * 3600 : -5 * 3600;
}
// Friday 16:00 ET close of ISO week w (UTC seconds)
export function fridayClose(w: number): number {
  const fri = weekStartTs(w) + 4 * DAY;
  const local = fri + 16 * 3600;
  return local - etOffset(local + 5 * 3600);
}
// Sunday 20:00 ET reopen of the weekend that starts on Friday of ISO week w
export function sundayReopen(w: number): number {
  const sun = weekStartTs(w) + 6 * DAY;
  const local = sun + 20 * 3600;
  return local - etOffset(local + 5 * 3600);
}
// True if a holding that started at `start` and was still held at `end` spans at least one full weekend gap.
export function coversGap(start: number, end: number): boolean {
  if (!start || end - start < 50 * 3600) return false;
  for (let w = weekIdx(start) - 1; w <= weekIdx(end); w++) {
    if (start <= fridayClose(w) && end >= sundayReopen(w)) return true;
  }
  return false;
}
