import { testWorkers } from '@pazarsync/vitest-config';
import { defineConfig } from 'vitest/config';

// DB-free unit tests (tests/unit/**). Deliberately SEPARATE from
// vitest.config.ts (the integration config): no .env, no DATABASE_URL remap,
// no globalSetup — and files run in parallel.
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/unit/**/*.test.ts'],
    maxWorkers: testWorkers(),
  },
});
