import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { remapDatabaseUrlToTestDb } from '@pazarsync/db/test-env';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'vitest/config';

// Local-dev convenience: pull DATABASE_URL etc. from the workspace-root .env
// so `pnpm --filter @pazarsync/profit test:integration` works without
// exporting env vars by hand. CI sets these via the workflow `env:` block,
// so a missing .env there is a no-op (dotenv silently skips when the file
// isn't found).
const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, '../../.env') });

// Redirect DATABASE_URL at the isolated test DB (see packages/db/src/test-env.ts).
// This config is integration-only; unit tests use vitest.unit.config.ts (no DB).
remapDatabaseUrlToTestDb();

export default defineConfig({
  test: {
    // Integration tests share one Postgres DB and TRUNCATE between tests.
    // Running test files in parallel would race on TRUNCATE.
    fileParallelism: false,
    globals: false,
    environment: 'node',
    // Seed the shipping reference fixture once (carriers + tariffs) so tests can
    // look up the seeded SENDEOMP carrier. Read-only fixture, never truncated.
    globalSetup: [path.resolve(here, './src/__tests__/global-setup.ts')],
    // Only integration tests — unit tests run via `test:unit` which uses
    // default vitest config (no DB needed, no dotenv required).
    include: [
      'src/**/__tests__/recompute-settled-profit-returns.test.ts',
      'src/**/__tests__/estimate-on-order-create-returns.test.ts',
      'src/**/__tests__/estimate-return-on-claim.test.ts',
      'src/**/__tests__/return-into-profit-e2e.test.ts',
      'src/**/__tests__/return-estimate-isolation.test.ts',
    ],
  },
});
