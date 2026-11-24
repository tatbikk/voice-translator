import type { NextConfig } from 'next';

// Demo tool entry points are named route.demo.ts / page.demo.tsx. They are part of
// the route table only when the image is built with DEMO_BUILD=true, so a
// production build contains no demo route at all (contract §9).
const demoBuild = process.env.DEMO_BUILD === 'true';

const staticSecurityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  pageExtensions: demoBuild ? ['tsx', 'ts', 'demo.tsx', 'demo.ts'] : ['tsx', 'ts'],
  env: {
    DEMO_ROUTES_BUILT: demoBuild ? 'true' : 'false',
  },
  serverExternalPackages: ['@node-rs/argon2', 'pg'],
  async headers() {
    return [{ source: '/:path*', headers: staticSecurityHeaders }];
  },
};

export default nextConfig;
