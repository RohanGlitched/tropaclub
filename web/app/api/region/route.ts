import { NextResponse } from 'next/server';
import { regionOf } from '@/lib/server/geo';

export const dynamic = 'force-dynamic';

// The region gate. Answers once per visitor and leaves a small cookie (tc_region) that the inline
// script in <head> reads before first paint on every later page, so nothing flashes.
// Buying is hidden in the United States and its territories only.
export async function GET(req: Request) {
  const r = await regionOf(req.headers);
  const value = r.us ? 'us' : r.unknown ? 'unknown' : 'ok';
  const res = NextResponse.json({ clubs: !r.us, region: value }, { headers: { 'Cache-Control': 'private, no-store' } });
  res.cookies.set('tc_region', value, { path: '/', maxAge: value === 'unknown' ? 3600 : 86400, sameSite: 'lax' });
  return res;
}
