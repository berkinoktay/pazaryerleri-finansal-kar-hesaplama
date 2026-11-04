import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Unit tests only: exclude the integration test that requires a real DB.
    include: ['src/**/__tests__/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      'src/**/__tests__/recompute-settled-profit-returns.test.ts',
      'src/**/__tests__/estimate-on-order-create-returns.test.ts',
      'src/**/__tests__/estimate-return-on-claim.test.ts',
      'src/**/__tests__/return-into-profit-e2e.test.ts',
      'src/**/__tests__/return-estimate-isolation.test.ts',
      'src/persistence/__tests__/load-trendyol-parcel.test.ts',
      'src/persistence/__tests__/recompute-parcel-profit.test.ts',
      'src/persistence/__tests__/compute-parcel-profit.test.ts',
      'src/persistence/__tests__/statement-breakdown-golden.test.ts',
      'src/persistence/__tests__/recompute-queue.test.ts',
      'src/persistence/__tests__/finance-records.test.ts',
    ],
  },
});
