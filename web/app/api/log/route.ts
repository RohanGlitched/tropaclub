import { rateLimited } from '@/lib/server/api';

export const dynamic = 'force-dynamic';

// Client error reports (lib/client-errors.ts): written to Cloud Logging as one structured line each.
// Nothing personal is kept: no IP, no wallet, no query string, no cookies. Bounded and rate-limited.
const cut = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : undefined);

export async function POST(req: Request) {
  if (rateLimited('client-log', req, 20)) return new Response(null, { status: 204 });
  const text = await req.text().catch(() => '');
  if (!text || text.length > 6000) return new Response(null, { status: 204 });
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(text);
  } catch {
    return new Response(null, { status: 204 });
  }
  // a route is a path only; anything that looks like a wallet address is shortened
  const route = (cut(j.route, 200) ?? '').split('?')[0]!.replace(/0x[0-9a-fA-F]{40}/g, (a) => `${a.slice(0, 6)}…`);
  const entry = {
    severity: 'ERROR',
    message: `[client] ${cut(j.kind, 12) ?? 'error'}: ${cut(j.message, 500) ?? ''}`,
    kind: cut(j.kind, 12),
    name: cut(j.name, 80),
    route,
    build: cut(j.build, 40),
    digest: cut(j.digest, 64),
    chunk: j.chunk === true,
    stack: (cut(j.stack, 2000) ?? '').replace(/0x[0-9a-fA-F]{40}/g, (a) => `${a.slice(0, 6)}…`),
    ua: (req.headers.get('user-agent') ?? '').slice(0, 160),
    'logging.googleapis.com/labels': { source: 'client' },
  };
  console.error(JSON.stringify(entry));
  return new Response(null, { status: 204 });
}
