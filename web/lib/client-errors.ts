// Client-side error handling shared by the error boundaries and the global reporter.
//
//   isChunkError: the page's JavaScript is from a build that is no longer served (a deploy happened
//     while the tab was open, or a cached page names old files). One reload fixes it.
//   reloadOnceForChunk: reloads once per tab session for that case; a second failure is shown.
//   reportClientError: sends message, stack, route and build id to /api/log (no wallet, no query
//     string, nothing personal), at most a few per page view.
export const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev';

export function isChunkError(e: unknown): boolean {
  const s = `${(e as { name?: string })?.name ?? ''} ${(e as { message?: string })?.message ?? String(e ?? '')}`;
  return /ChunkLoadError|Loading chunk [\w-]+ failed|Loading CSS chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(s);
}

const RELOAD_KEY = 'tc-chunk-reload';

/** Reload the page once for a chunk error. Returns true when a reload was started. */
export function reloadOnceForChunk(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    // one automatic reload per tab per minute at most: never a loop
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // no session storage: reload only if this page has not been reloaded for it already
    if (/[?&]_r=1(&|$)/.test(location.search)) return false;
    const u = new URL(location.href);
    u.searchParams.set('_r', '1');
    location.replace(u.toString());
    return true;
  }
  location.reload();
  return true;
}

let sent = 0;
const seen = new Set<string>();

export function reportClientError(kind: 'error' | 'rejection' | 'boundary', e: unknown, extra?: { digest?: string }): void {
  try {
    if (sent >= 5) return;
    const err = e as { message?: string; stack?: string; name?: string };
    const message = String(err?.message ?? e ?? 'unknown').slice(0, 500);
    const key = `${kind}:${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    sent++;
    const body = JSON.stringify({
      kind,
      name: String(err?.name ?? '').slice(0, 80),
      message,
      stack: String(err?.stack ?? '').slice(0, 2000),
      route: location.pathname.slice(0, 200),
      build: BUILD_ID,
      digest: extra?.digest?.slice(0, 64),
      chunk: isChunkError(e),
    });
    const blob = new Blob([body], { type: 'application/json' });
    if (!navigator.sendBeacon?.('/api/log', blob)) void fetch('/api/log', { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: true }).catch(() => {});
  } catch {
    /* reporting must never break the page */
  }
}
