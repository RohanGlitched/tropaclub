import { NextResponse } from 'next/server';
import { SITE_URL } from '@/lib/site';

// The default share picture is a static file. Nothing is rendered per request.
// The address is built from the site's own URL, never from the request.
export function GET() {
  return NextResponse.redirect(`${SITE_URL}/og-default.png`, 308);
}
