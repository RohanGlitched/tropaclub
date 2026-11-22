import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import './club.css';
import '@/components/nav/nav.css';
import { SITE_URL, TAGLINE } from '@/lib/site';
import { homeOgVersion } from '@/lib/og';
import { getIndex } from '@/lib/server/data';
import ScoutCapture from '@/components/ScoutCapture';

const display = localFont({
  src: [
    { path: '../assets/fonts/bsc-500.woff2', weight: '500', style: 'normal' },
    { path: '../assets/fonts/bsc-600.woff2', weight: '600', style: 'normal' },
    { path: '../assets/fonts/bsc-700.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-display',
  display: 'swap',
  fallback: ['Bahnschrift', 'DIN Alternate', 'Arial Narrow', 'system-ui', 'sans-serif'],
});

// The share picture shows the live count: /api/card/og/home.jpg, versioned by the count time.
export async function generateMetadata(): Promise<Metadata> {
  const asOf = await getIndex().then((i) => i.data.asOf).catch(() => null);
  const image = asOf ? `${SITE_URL}/api/card/og/home.jpg?v=${encodeURIComponent(homeOgVersion(asOf))}` : '/og-default.png';
  return { ...base, openGraph: { ...base.openGraph, images: [{ url: image, width: 1200, height: 630, alt: 'Tropa Club: a stock token’s holders drawn as a stadium, with real holders lit' }] }, twitter: { ...base.twitter, images: [image] } };
}

const base: Metadata = {
  metadataBase: new URL(SITE_URL),
  // every page names its own address on tropaclub.xyz as the canonical one (the *.web.app copy is a duplicate)
  alternates: { canonical: './' },
  manifest: '/manifest.webmanifest',
  title: { default: 'Tropa Club: who really holds each stock token', template: '%s · Tropa Club' },
  description: `Tropa Club shows who really holds each Coinbase stock token on Base, and helps your group chat each buy about $10 a week from your own wallets. ${TAGLINE}`,
  openGraph: {
    siteName: 'Tropa Club',
    type: 'website',
    images: [{ url: '/og-default.png', width: 1200, height: 630, alt: 'Tropa Club: a stock token’s holders drawn as a stadium, with real holders lit' }],
  },
  twitter: { card: 'summary_large_image', site: '@tropaclubxyz' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F4F1E8' },
    { media: '(prefers-color-scheme: dark)', color: '#121037' },
  ],
};

const themeScript = `(function(){var d=document.documentElement;try{var q=new URLSearchParams(location.search).get('theme');var t=q||localStorage.getItem('tropa-theme');if(t==='light'||t==='dark')d.dataset.theme=t;}catch(e){}try{var m=document.cookie.match(/(?:^|; )tc_region=(us|blocked|ok|unknown)/);d.dataset.region=m?(m[1]==='us'||m[1]==='blocked'?'restricted':m[1]):'pending';}catch(e){d.dataset.region='pending';}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={display.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <ScoutCapture />
        <a className="skip" href="#main">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
