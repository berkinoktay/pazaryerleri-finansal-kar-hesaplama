import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Unit tests only: exclude the integration test that requires a real DB.
    include: ['src/**/__tests__/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      'src/persistence/__tests__/load-trendyol-parcel.test.ts',
      'src/persistence/__tests__/load-trendyol-scenario.test.ts',
      'src/persistence/__tests__/recompute-parcel-profit.test.ts',
      'src/persistence/__tests__/compute-parcel-profit.test.ts',
      'src/persistence/__tests__/profit-row-tenant-fk.test.ts',
      'src/persistence/__tests__/statement-breakdown-golden.test.ts',
      'src/persistence/__tests__/recompute-queue.test.ts',
      'src/persistence/__tests__/finance-records.test.ts',
    ],
  },
});
