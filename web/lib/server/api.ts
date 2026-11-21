// The pattern every API route follows: validate, rate-limit, call a server-only module, answer with ok() or fail().
import 'server-only';
import { NextResponse } from 'next/server';

export const ok = <T>(data: T, cache = 'private, no-store') => NextResponse.json(data, { headers: { 'Cache-Control': cache } });
export const fail = (status: number, error: string, cache = 'private, no-store') => NextResponse.json({ error }, { status, headers: { 'Cache-Control': cache } });

export function clientIp(req: Request): string {
  return (req.headers.get('x-forwarded-for') || 'local').split(',')[0].trim();
}

const buckets = new Map<string, number[]>();
/** True when this caller has gone over `perMinute` for the named bucket. Per instance, in memory. */
export function rateLimited(bucket: string, req: Request, perMinute: number): boolean {
  const key = `${bucket}:${clientIp(req)}`;
  const now = Date.now();
  const list = (buckets.get(key) ?? []).filter((t) => now - t < 60_000);
  list.push(now);
  buckets.set(key, list);
  if (buckets.size > 5000) buckets.clear();
  return list.length > perMinute;
}

export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

/** Wraps a route body: engine errors carry their own sentence and status; anything else is a calm 500. */
export async function guarded(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (e) {
    const err = e as { name?: string; status?: number; message?: string };
    if (err?.name === 'ClubsError') return fail(err.status ?? 400, err.message ?? 'That did not work.');
    console.error('[api]', err?.message);
    return fail(500, 'Something went wrong on our side. Try again in a minute.');
  }
}
