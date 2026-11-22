/** Scheduled jobs run once per run key, even when Cloud Scheduler retries after a Hosting cutoff. */
import { describe, expect, it } from 'vitest';
import { CRON_RUNS, type CronRunDoc, cronRunKey, runOnce } from '../src/runs';
import { MemoryDocStore } from '../src/store/memory';

describe('runOnce', () => {
  it('runs once, then replays the kept result', async () => {
    const store = new MemoryDocStore();
    let runs = 0;
    const job = async () => ({ settled: ++runs });
    expect(await runOnce(store, 'settle-gameweek:GW1', job)).toEqual({ status: 'ran', result: { settled: 1 } });
    expect(await runOnce(store, 'settle-gameweek:GW1', job)).toMatchObject({ status: 'replayed', result: { settled: 1 } });
    expect(runs).toBe(1);
  });

  it('a retry while the first run is still going does not start a second one', async () => {
    const store = new MemoryDocStore();
    let release!: () => void;
    let runs = 0;
    const slow = () => new Promise<number>((r) => { runs++; release = () => r(runs); });
    const first = runOnce(store, 'k', slow);
    await new Promise((r) => setTimeout(r, 0));
    expect(await runOnce(store, 'k', slow)).toMatchObject({ status: 'running' });
    release();
    expect(await first).toEqual({ status: 'ran', result: 1 });
    expect(runs).toBe(1);
  });

  it('takes over a stale or failed run', async () => {
    const store = new MemoryDocStore();
    let t = 1_000_000;
    await store.set<CronRunDoc>(CRON_RUNS, 'k', { key: 'k', state: 'running', startedAt: t, attempts: 1 });
    t += 7 * 60_000;
    expect(await runOnce(store, 'k', async () => 'ok', { now: () => t })).toEqual({ status: 'ran', result: 'ok' });
    expect((await store.get<CronRunDoc>(CRON_RUNS, 'k'))!.attempts).toBe(2);
    await expect(runOnce(store, 'f', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await store.get<CronRunDoc>(CRON_RUNS, 'f')).toMatchObject({ state: 'failed', error: 'boom' });
    expect(await runOnce(store, 'f', async () => 2)).toEqual({ status: 'ran', result: 2 });
  });

  it('keys gameweek jobs by gameweek and the rest by a ten-minute slot', () => {
    expect(cronRunKey('settle-gameweek', { gw: 'GW1', nowSec: 5 })).toBe('settle-gameweek:GW1');
    expect(cronRunKey('sweep-transfers', { nowSec: 1_800_000_123 })).toBe('sweep-transfers:1800000000');
    expect(cronRunKey('sweep-transfers', { nowSec: 1_800_000_599 })).toBe(cronRunKey('sweep-transfers', { nowSec: 1_800_000_100 }));
  });
});
