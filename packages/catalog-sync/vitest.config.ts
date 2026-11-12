import { testWorkers } from '@pazarsync/vitest-config';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    maxWorkers: testWorkers(),
  },
});
