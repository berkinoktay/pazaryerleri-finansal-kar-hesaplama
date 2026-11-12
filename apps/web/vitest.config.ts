import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

import { testWorkers } from '@pazarsync/vitest-config';

import { hugeiconsImportsPlugin } from './tests/tooling/hugeicons-imports-plugin';

export default defineConfig({
  // hugeiconsImportsPlugin mirrors next.config's optimizePackageImports for the
  // test runner: per-icon imports instead of re-loading two 4 600-module barrels
  // in every test file. See the plugin file for details.
  plugins: [react(), hugeiconsImportsPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'happy-dom',
    maxWorkers: testWorkers(),
    globals: false,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});
