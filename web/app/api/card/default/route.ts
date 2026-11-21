import { NextResponse } from 'next/server';

// The default share picture is a static file. Nothing is rendered per request.
export function GET(req: Request) {
  return NextResponse.redirect(new URL('/og-default.png', req.url), 308);
}
