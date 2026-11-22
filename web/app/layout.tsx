import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import './club.css';
import { SITE_URL, TAGLINE } from '@/lib/site';
import { homeOgVersion } from '@/lib/og';
import { getIndex } from '@/lib/server/data';

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
  return { ...base, openGraph: { ...base.openGraph, images: [{ url: image, width: 1200, height: 630, alt: 'Tropa Club: the seating plan of a stock token, with real fans lit' }] }, twitter: { ...base.twitter, images: [image] } };
}

const base: Metadata = {
  metadataBase: new URL(SITE_URL),
  // every page names its own address on tropaclub.xyz as the canonical one (the *.web.app copy is a duplicate)
  alternates: { canonical: './' },
  manifest: '/manifest.webmanifest',
  title: { default: 'Tropa Club: tickets sold vs fans who showed up', template: '%s · Tropa Club' },
  description: `Every stock token on Base is a football club, and every holder wallet is a seat. See who really showed up, and find your own seat. Tropa Club: ${TAGLINE}`,
  openGraph: {
    siteName: 'Tropa Club',
    type: 'website',
    images: [{ url: '/og-default.png', width: 1200, height: 630, alt: 'Tropa Club: the seating plan of a stock token, with real fans lit' }],
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
        <a className="skip" href="#main">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
