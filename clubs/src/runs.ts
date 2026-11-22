/**
 * Run a scheduled job at most once per run key.
 *
 * Firebase Hosting cuts a request off at 60 s, so Cloud Scheduler sees a timeout and retries while
 * the first run is still going on Cloud Run (up to 300 s). The run key (`settle-gameweek:GW1`, or
 * the job and its time slot) is claimed with an atomic create in `cronRuns`:
 *   - claimed now: the job runs, and its result is kept on the key;
 *   - already done: the kept result is returned and nothing runs again;
 *   - still running and fresh: 'running' is returned and nothing runs;
 *   - running but stale (the instance died), or failed: this call takes it over.
 */
import { AlreadyExistsError, type DocStore } from './store/docstore';

export const CRON_RUNS = 'cronRuns';

export interface CronRunDoc {
  key: string;
  state: 'running' | 'done' | 'failed';
  startedAt: number;
  finishedAt?: number;
  /** JSON of what the job returned. */
  result?: string;
  error?: string;
  attempts: number;
}

export type RunOnce<T> = { status: 'ran'; result: T } | { status: 'replayed'; result: T; finishedAt: number } | { status: 'running'; startedAt: number };

export async function runOnce<T>(
  store: DocStore,
  key: string,
  run: () => Promise<T>,
  opts: { now?: () => number; staleMs?: number; force?: boolean } = {},
): Promise<RunOnce<T>> {
  const now = opts.now ?? Date.now;
  const stale = opts.staleMs ?? 6 * 60_000;
  const startedAt = now();
  let attempts = 1;
  try {
    await store.create<CronRunDoc>(CRON_RUNS, key, { key, state: 'running', startedAt, attempts });
  } catch (e) {
    if (!(e instanceof AlreadyExistsError)) throw e;
    // Decide and take the key over in one transaction, so two retries cannot both take a stale run.
    let seen: CronRunDoc | null = null;
    const took = await store.transact<CronRunDoc>(CRON_RUNS, key, (d) => {
      seen = d;
      if (d?.state === 'done' && !opts.force) return null;
      if (d?.state === 'running' && startedAt - d.startedAt < stale) return null;
      return { key, state: 'running', startedAt, attempts: (d?.attempts ?? 1) + 1 };
    });
    if (!took) {
      const d = seen as CronRunDoc | null;
      if (d?.state === 'done') return { status: 'replayed', result: JSON.parse(d.result ?? 'null') as T, finishedAt: d.finishedAt ?? d.startedAt };
      return { status: 'running', startedAt: d?.startedAt ?? startedAt };
    }
    attempts = took.attempts;
  }
  try {
    const result = await run();
    await store.set<CronRunDoc>(CRON_RUNS, key, { key, state: 'done', startedAt, finishedAt: now(), result: JSON.stringify(result ?? null), attempts });
    return { status: 'ran', result };
  } catch (e) {
    await store.set<CronRunDoc>(CRON_RUNS, key, { key, state: 'failed', startedAt, finishedAt: now(), error: String((e as Error)?.message ?? e).slice(0, 300), attempts }).catch(() => {});
    throw e;
  }
}

/** The run key for a job: a gameweek job by its gameweek, anything else by its time slot. */
export function cronRunKey(job: string, o: { gw?: string | null; nowSec: number; slotSec?: number }): string {
  if (o.gw) return `${job}:${o.gw}`;
  const slot = o.slotSec ?? 600;
  return `${job}:${Math.floor(o.nowSec / slot) * slot}`;
}
