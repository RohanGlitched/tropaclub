import { NextResponse } from 'next/server';
import { isCardName, readLocalCard } from '@/lib/server/cardstore';

export const dynamic = 'force-dynamic';

// Serves pictures written to web/.cards when the bucket is not available (local development).
export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  if (!isCardName(name)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const jpeg = await readLocalCard(name);
  if (!jpeg) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return new Response(new Uint8Array(jpeg), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=300' } });
}
