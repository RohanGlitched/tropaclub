import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Tropa Club',
    short_name: 'Tropa Club',
    description: 'See who really holds each stock token on Base, and buy about $10 a week with your group chat, each from your own wallet.',
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
