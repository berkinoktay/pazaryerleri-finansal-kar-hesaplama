import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Unit tests only: exclude the integration test that requires a real DB.
    include: ['src/**/__tests__/*.test.ts'],
    exclude: ['**/node_modules/**', 'src/**/__tests__/recompute-settled-profit-returns.test.ts'],
  },
});
