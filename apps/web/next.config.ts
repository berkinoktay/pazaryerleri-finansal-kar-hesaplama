import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const nextConfig: NextConfig = {
  transpilePackages: ['@pazarsync/utils'],
  experimental: {
    // Rewrites `import { X } from 'hugeicons-react'` barrel imports (171 call
    // sites) into direct per-icon imports at build time, so the bundler tree-
    // shakes the icon set instead of pulling the whole barrel.
    optimizePackageImports: ['hugeicons-react'],
  },
};

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withNextIntl(nextConfig);
