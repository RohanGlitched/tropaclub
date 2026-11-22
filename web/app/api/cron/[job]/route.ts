import { createHash, timingSafeEqual } from 'node:crypto';
import { cronRunKey, currentGameweek, lastSettledGameweek, runOnce } from '@tropaclub/clubs';
import { fail, guarded, ok } from '@/lib/server/api';
import { getClubs } from '@/lib/server/clubs';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Scheduled jobs, called by Cloud Scheduler with the header  x-cron-secret: $CRON_SECRET.
//   POST /api/cron/refresh-matchday     every 30 min in US market hours
//   POST /api/cron/capture-marks        at each close (16:00 ET, 13:00 on half days), before refresh-matchday
//   POST /api/cron/sweep-transfers      every 30 min
//   POST /api/cron/match-pickups        hourly
//   POST /api/cron/schedule-fixtures    Monday open        (?gw=GW1 to name the gameweek)
//   POST /api/cron/settle-gameweek      Friday after close (?gw=GW1 to name the gameweek)
// Each run claims a run key in Firestore first (gameweek jobs by gameweek, the rest by ten-minute
// slot). Hosting cuts a request off at 60 s and Scheduler then retries while the first run is still
// going, so a retry gets the first run's result, or "running", and never a second run.
// ?force=1 runs a finished key again (never one that is still running).
const JOBS = new Set(['refresh-matchday', 'capture-marks', 'sweep-transfers', 'match-pickups', 'schedule-fixtures', 'settle-gameweek']);

// Both sides hashed first, so the comparison is constant-time and does not reveal the length.
const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();
const secretMatches = (got: string | null, want: string) => got != null && timingSafeEqual(digest(got), digest(want));

export const POST = (req: Request, ctx: { params: Promise<{ job: string }> }) =>
  guarded(async () => {
    const secret = process.env.CRON_SECRET;
    if (!secret || secret.length < 12) return fail(503, 'Cron is not configured');
    if (!secretMatches(req.headers.get('x-cron-secret'), secret)) return fail(401, 'Not allowed');
    const { job } = await ctx.params;
    if (!JOBS.has(job)) return fail(404, 'Unknown job');
    const url = new URL(req.url);
    const gwParam = url.searchParams.get('gw');
    const force = url.searchParams.get('force') === '1';
    const clubs = await getClubs();
    const now = clubs.ctx.now();

    let gw: string | null = null;
    if (job === 'schedule-fixtures') {
      gw = gwParam ?? currentGameweek(now)?.id ?? null;
      if (!gw) return fail(409, 'No gameweek is open');
    } else if (job === 'settle-gameweek') {
      gw = gwParam ?? lastSettledGameweek(now)?.id ?? null;
      if (!gw) return fail(409, 'No gameweek has ended');
    }

    const work = async (): Promise<Record<string, unknown>> => {
      switch (job) {
        case 'refresh-matchday':
          return { result: await clubs.refreshMatchday() };
        case 'capture-marks':
          return { marks: await clubs.captureCutMarks() };
        case 'sweep-transfers':
          return { result: await clubs.sweepTransfers() };
        case 'match-pickups':
          return { result: await clubs.matchPickups() };
        case 'schedule-fixtures':
          return { gw, fixtures: (await clubs.scheduleFixtures(gw!)).length };
        default: {
          const r = await clubs.settleGameweek(gw!);
          return { gw, results: r.results.length, fixtures: r.fixtures.length };
        }
      }
    };
    const key = cronRunKey(job, { gw, nowSec: now });
    const run = await runOnce(clubs.ctx.store, key, work, { force });
    if (run.status === 'running') return accepted({ job, key, status: 'running', startedAt: run.startedAt });
    return ok({ job, key, status: run.status, ...run.result });
  });

function accepted(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status: 202, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } });
}
