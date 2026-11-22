import { NextResponse, type NextRequest } from 'next/server';
import { allowedHost, canonicalHost } from '@/lib/hosts';

// Rules applied before any route runs:
//   1. The API only answers on our own hosts. A request to the bare Cloud Run URL (or any other
//      host) gets 403, so forged forwarding headers there reach nothing.
//   2. Pages stay reachable on other hosts (the *.web.app copy, the Cloud Run URL) but are marked
//      noindex. Every page also carries a canonical link to tropaclub.xyz.
export function middleware(req: NextRequest) {
  const isApi = req.nextUrl.pathname.startsWith('/api/');
  if (isApi && !allowedHost(req.headers)) {
    return NextResponse.json({ error: 'This API is only served at tropaclub.xyz.' }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } });
  }
  // A ticket for something that is not a wallet address does not exist: a real 404, not a soft one.
  const ticket = req.nextUrl.pathname.match(/^\/(?:ticket|statement)\/([^/]+)\/?$/);
  if (ticket && !/^0x[0-9a-fA-F]{40}$/.test(decodeURIComponent(ticket[1]))) {
    return NextResponse.rewrite(new URL('/not-a-page', req.url), { status: 404 });
  }
  const res = NextResponse.next();
  if (!isApi && !canonicalHost(req.headers)) res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return res;
}

// /api/* always runs the middleware, whatever the path ends in (/api/card/x.png is still the API).
// Everything else skips Next's own assets and static files.
export const config = { matcher: ['/api/:path*', '/((?!_next/|brand/|api/|.*\\.(?:png|jpg|svg|ico|webmanifest|txt|xml|woff2?)$).*)'] };
