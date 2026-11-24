import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { configureWorkerDatabases, remapDatabaseUrlToTestDb } from '@pazarsync/db/test-env';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'vitest/config';

import { INTEGRATION_TEST_TIMEOUT_MS, testWorkers } from '@pazarsync/vitest-config';

// Local-dev convenience: pull DATABASE_URL etc. from the workspace-root .env
// so `pnpm --filter @pazarsync/profit test:integration` works without
// exporting env vars by hand. CI sets these via the workflow `env:` block,
// so a missing .env there is a no-op (dotenv silently skips when the file
// isn't found).
const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, '../../.env') });

// Redirect DATABASE_URL at the isolated test DB (see packages/db/src/test-env.ts).
// This config is integration-only; unit tests use vitest.unit.config.ts (no DB).
// Every worker gets its own clone of the test DB template, which already
// carries the shipping reference fixture (SENDEOMP carrier) these tests use.
remapDatabaseUrlToTestDb();
const workerDatabases = configureWorkerDatabases('profit');

export default defineConfig({
  test: {
    // Files run in parallel, each worker on its own database clone.
    maxWorkers: testWorkers(),
    testTimeout: INTEGRATION_TEST_TIMEOUT_MS,
    globals: false,
    environment: 'node',
    globalSetup: [workerDatabases.globalSetup],
    setupFiles: workerDatabases.setupFiles,
    // Only integration tests — unit tests run via `test:unit` which uses
    // default vitest config (no DB needed, no dotenv required).
    include: [
      'src/persistence/__tests__/load-trendyol-parcel.test.ts',
      'src/persistence/__tests__/load-trendyol-scenario.test.ts',
      'src/persistence/__tests__/recompute-parcel-profit.test.ts',
      'src/persistence/__tests__/compute-parcel-profit.test.ts',
      'src/persistence/__tests__/profit-row-tenant-fk.test.ts',
      'src/persistence/__tests__/statement-breakdown-golden.test.ts',
      'src/persistence/__tests__/recompute-queue.test.ts',
      'src/persistence/__tests__/finance-records.test.ts',
      'src/persistence/__tests__/trendyol-reference-loaders.test.ts',
      'src/persistence/__tests__/tariff-version.test.ts',
      'src/persistence/__tests__/order-profit-snapshot.test.ts',
      'src/persistence/__tests__/recompute-parcel-profit-snapshot.test.ts',
      'src/persistence/__tests__/seller-inputs-at.test.ts',
      'src/persistence/__tests__/db-clock.test.ts',
      'src/__tests__/build-calc-check-lines.test.ts',
    ],
  },
});
