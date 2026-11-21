import { NextResponse } from 'next/server';
import { dataBaseUrl, getSeatsResponse, getToken } from '@/lib/server/data';

export const dynamic = 'force-dynamic';

// One club's seat list. These files run to megabytes. With live data the browser is sent straight
// to the public file, which is stored gzip-compressed and allows any origin, so nothing large
// passes through this server. Sample data is small and is answered here.
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const { token, index } = await getToken(decodeURIComponent(symbol));
  if (!token) return NextResponse.json({ error: 'No such club' }, { status: 404, headers: { 'Cache-Control': 'public, max-age=30, s-maxage=60' } });
  if (index.source === 'live') {
    return new Response(null, { status: 307, headers: { Location: `${dataBaseUrl}/tokens/${encodeURIComponent(token.symbol)}.json`, 'Cache-Control': 'public, max-age=300, s-maxage=300' } });
  }
  const r = await getSeatsResponse(token.symbol);
  if (!r) return NextResponse.json({ error: 'Seat list not published yet' }, { status: 404, headers: { 'Cache-Control': 'public, max-age=30, s-maxage=60' } });
  return new Response(r.body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=120, s-maxage=300', 'X-Data-Source': r.source } });
}
