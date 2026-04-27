import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false, // integration tests share one DB
    globals: false,
    environment: 'node',
  },
});
