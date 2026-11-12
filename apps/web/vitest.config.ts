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
    maxWorkers: testWorkers(),
    globals: false,
    // The file extension picks the environment: `.ts` unit tests are pure logic
    // and run in plain node (no happy-dom, no jest-dom, no MSW server — that
    // setup used to cost more than the tests themselves); `.tsx` unit tests and
    // every component test render React and get the DOM + MSW setup.
    projects: [
      {
        extends: true,
        test: {
          name: 'unit-node',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
          setupFiles: ['./tests/setup-node.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'unit-dom',
          environment: 'happy-dom',
          include: ['tests/unit/**/*.test.tsx'],
          setupFiles: ['./tests/setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'component',
          environment: 'happy-dom',
          include: ['tests/component/**/*.test.{ts,tsx}'],
          setupFiles: ['./tests/setup.ts'],
        },
      },
    ],
  },
});
