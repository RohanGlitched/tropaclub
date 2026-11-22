import { NextResponse } from 'next/server';
import { regionOf } from '@/lib/server/geo';

export const dynamic = 'force-dynamic';

// The region gate. Answers once per visitor and leaves a small cookie (tc_region) that the inline
// script in <head> reads before first paint on every later page, so nothing flashes.
// Buying is hidden in the US and its territories, sanctioned countries and on Tor ("blocked"), and
// refused when the country cannot be told ("unknown": pages stay open, the buy button does not).
export async function GET(req: Request) {
  const r = await regionOf(req.headers);
  const value = r.us ? 'us' : r.restricted ? 'blocked' : r.unknown ? 'unknown' : 'ok';
  const res = NextResponse.json({ clubs: !r.restricted, region: value }, { headers: { 'Cache-Control': 'private, no-store' } });
  res.cookies.set('tc_region', value, { path: '/', maxAge: value === 'unknown' ? 3600 : 86400, sameSite: 'lax' });
  return res;
}
