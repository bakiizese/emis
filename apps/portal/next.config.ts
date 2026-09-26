import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  // The app lives in a monorepo: trace shared workspace packages from the repository root so the
  // standalone server carries everything it needs.
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@emis/ui'],
};

export default nextConfig;
