import { defineConfig } from 'vitest/config';

import { testWorkers } from '@pazarsync/vitest-config';

export default defineConfig({
  test: {
    environment: 'node',
    maxWorkers: testWorkers(),
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
