import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Tropa Club',
    short_name: 'Tropa Club',
    description: '$10 a week in stocks with your group chat. Tickets sold vs fans who showed up, for every stock token on Base.',
    start_url: '/',
    display: 'standalone',
    background_color: '#121037',
    theme_color: '#121037',
    icons: [
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
