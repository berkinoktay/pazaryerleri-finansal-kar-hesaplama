import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { testWorkers } from '@pazarsync/vitest-config';
import { defineConfig } from 'vitest/config';

// DB-free unit tests (tests/unit/**). Deliberately SEPARATE from
// vitest.config.ts (the integration config): no .env, no DATABASE_URL remap,
// no globalSetup — and files run in parallel. Sharing the integration config
// used to force these tests through `fileParallelism: false` too.
const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    // Mirror the `@/*` → `./src/*` alias declared in tsconfig.json.
    alias: {
      '@': path.resolve(here, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    maxWorkers: testWorkers(),
  },
});
