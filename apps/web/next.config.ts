import type { NextConfig } from 'next';

// In development the site proxies /api to the API so the pre-registration form stays same-origin.
// In production Caddy routes /api straight to the API on the same domain.
const apiUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@emis/ui'],
  rewrites() {
    return Promise.resolve([{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }]);
  },
};

export default nextConfig;
