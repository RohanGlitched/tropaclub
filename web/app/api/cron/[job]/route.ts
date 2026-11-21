import { currentGameweek, lastSettledGameweek } from '@tropaclub/clubs';
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
export const POST = (req: Request, ctx: { params: Promise<{ job: string }> }) =>
  guarded(async () => {
    const secret = process.env.CRON_SECRET;
    if (!secret || secret.length < 12) return fail(503, 'Cron is not configured');
    if (req.headers.get('x-cron-secret') !== secret) return fail(401, 'Not allowed');
    const { job } = await ctx.params;
    const gwParam = new URL(req.url).searchParams.get('gw');
    const clubs = await getClubs();
    const now = clubs.ctx.now();
    switch (job) {
      case 'refresh-matchday':
        return ok({ job, result: await clubs.refreshMatchday() });
      case 'capture-marks':
        return ok({ job, marks: await clubs.captureCutMarks() });
      case 'sweep-transfers':
        return ok({ job, result: await clubs.sweepTransfers() });
      case 'match-pickups':
        return ok({ job, result: await clubs.matchPickups() });
      case 'schedule-fixtures': {
        const gw = gwParam ?? currentGameweek(now)?.id;
        if (!gw) return fail(409, 'No gameweek is open');
        return ok({ job, gw, fixtures: (await clubs.scheduleFixtures(gw)).length });
      }
      case 'settle-gameweek': {
        const gw = gwParam ?? lastSettledGameweek(now)?.id;
        if (!gw) return fail(409, 'No gameweek has ended');
        const r = await clubs.settleGameweek(gw);
        return ok({ job, gw, results: r.results.length, fixtures: r.fixtures.length });
      }
      default:
        return fail(404, 'Unknown job');
    }
  });
