import { defineConfig } from 'vitest/config';

import { testWorkers } from '@pazarsync/vitest-config';

export default defineConfig({
  test: {
    environment: 'node',
    maxWorkers: testWorkers(),
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // The gate tests time crafted inputs against loose bounds (tens of seconds) so a
    // loaded machine cannot flap them; the default 5 s test timeout would fire first.
    testTimeout: 60_000,
  },
});
