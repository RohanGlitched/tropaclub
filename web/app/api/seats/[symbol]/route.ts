import { NextResponse } from 'next/server';
import { getSeatsResponse } from '@/lib/server/data';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  if (!/^[A-Za-z0-9.]{1,12}$/.test(symbol)) return NextResponse.json({ error: 'Unknown club' }, { status: 400 });
  const r = await getSeatsResponse(symbol);
  if (!r) return NextResponse.json({ error: 'Seat list not published yet' }, { status: 404, headers: { 'Cache-Control': 'public, max-age=30, s-maxage=60' } });
  return new Response(r.body, {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=120, s-maxage=300', 'X-Data-Source': r.source },
  });
}
