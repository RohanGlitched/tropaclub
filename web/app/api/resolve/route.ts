import { NextResponse } from 'next/server';
import { isAddress } from '@/lib/format';

// Basename / ENS lookup through a public resolver. Only the name the visitor typed is sent.
const RESOLVERS = [(n: string) => `https://api.ensdata.net/${encodeURIComponent(n)}`, (n: string) => `https://api.web3.bio/ns/${encodeURIComponent(n)}`];

function pick(j: unknown): string | null {
  if (!j) return null;
  const o = (Array.isArray(j) ? j[0] : j) as Record<string, unknown> | undefined;
  const a = o && typeof o.address === 'string' ? o.address : null;
  return a && isAddress(a) ? a.toLowerCase() : null;
}

export async function GET(req: Request) {
  const name = (new URL(req.url).searchParams.get('name') || '').trim().toLowerCase();
  if (!/^[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63}){1,3}$/.test(name)) return NextResponse.json({ message: 'That does not look like a name. Paste the 0x address instead.' }, { status: 400 });
  for (const url of RESOLVERS) {
    try {
      const res = await fetch(url(name), { signal: AbortSignal.timeout(4500), headers: { accept: 'application/json' }, next: { revalidate: 3600 } });
      if (!res.ok) continue;
      const address = pick(await res.json());
      if (address) return NextResponse.json({ address }, { headers: { 'Cache-Control': 'public, max-age=600' } });
    } catch {
      /* try the next resolver */
    }
  }
  return NextResponse.json({ message: `No wallet found for ${name}. Paste the 0x address instead.` });
}
