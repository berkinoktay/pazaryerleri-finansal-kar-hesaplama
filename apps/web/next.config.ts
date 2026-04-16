import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@pazarsync/types', '@pazarsync/utils'],
};

export default nextConfig;
