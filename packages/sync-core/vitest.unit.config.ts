import { testWorkers } from '@pazarsync/vitest-config';
import { defineConfig } from 'vitest/config';

// DB-free unit tests (src/**/*.test.ts). Deliberately SEPARATE from
// vitest.config.ts (the integration config): no .env, no DATABASE_URL remap —
// and files run in parallel.
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
    maxWorkers: testWorkers(),
  },
});
