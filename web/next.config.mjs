import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // shared/, buy/ and clubs/ live one level up (app/), so trace from app/.
  outputFileTracingRoot: path.join(here, '..'),
  outputFileTracingIncludes: {
    '/api/card': ['./assets/fonts/*.woff', './assets/*.svg'],
    '/api/card/default': ['./assets/fonts/*.woff', './assets/*.svg'],
  },
  experimental: { externalDir: true },
  // Static pages revalidate every 5 minutes. A CDN may serve a stale copy for 10 more minutes at most
  // (Cache-Control: s-maxage=300, stale-while-revalidate=600), not for a year.
  expireTime: 900,
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ['@google-cloud/storage', 'firebase-admin', 'sharp'],
  webpack(config) {
    // The sibling packages (../buy, ../clubs) are consumed as source. Their bare imports must resolve
    // from web/node_modules when they have no node_modules of their own (the container build).
    config.resolve.modules = [...(config.resolve.modules ?? ['node_modules']), path.join(here, 'node_modules')];
    config.resolve.alias = {
      ...config.resolve.alias,
      '@tropaclub/buy': path.join(here, '../buy/src/index.ts'),
      '@tropaclub/clubs': path.join(here, '../clubs/src/index.ts'),
      '@buy': path.join(here, '../buy/src'),
      '@clubs': path.join(here, '../clubs/src'),
      // wagmi's connector barrel also re-exports connectors this app does not offer. Their SDKs are
      // left out of the bundle (only coinbaseWallet and injected are used).
      '@base-org/account': false,
      '@metamask/sdk': false,
      '@walletconnect/ethereum-provider': false,
      '@safe-global/safe-apps-provider': false,
      '@safe-global/safe-apps-sdk': false,
      '@gemini-wallet/core': false,
      porto: false,
      'porto/internal': false,
    };
    // Optional peers of wallet SDKs that are never used in the browser build.
    config.externals.push('pino-pretty', 'lokijs', 'encoding');
    config.resolve.fallback = { ...config.resolve.fallback, '@react-native-async-storage/async-storage': false };
    return config;
  },
  async redirects() {
    return [
      { source: '/docs', destination: 'https://docs.tropaclub.xyz', permanent: false },
      { source: '/docs/:path*', destination: 'https://docs.tropaclub.xyz/:path*', permanent: false },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
    ];
  },
};

export default nextConfig;
