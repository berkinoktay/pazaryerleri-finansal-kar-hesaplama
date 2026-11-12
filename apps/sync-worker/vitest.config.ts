import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { configureWorkerDatabases, remapDatabaseUrlToTestDb } from '@pazarsync/db/test-env';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'vitest/config';

import { testWorkers } from '@pazarsync/vitest-config';

// Local-dev convenience: pull DATABASE_URL etc. from the workspace-root .env
// so `pnpm --filter @pazarsync/sync-worker test:integration` works without
// exporting env vars by hand. CI sets these via the workflow `env:` block,
// so a missing .env there is a no-op (dotenv silently skips when the file
// isn't found).
const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, '../../.env') });

// Integration-only config (tests/integration/**). DB-free unit tests have their
// own vitest.unit.config.ts, which runs files in parallel.
// Redirect DATABASE_URL at the isolated test DB (see packages/db/src/test-env.ts),
// then give every worker its own clone of it (packages/db/src/test-db-clones.ts).
// The shipping reference fixture the claims handler needs is part of the
// template (`pnpm db:test-setup`), so every clone starts with it.
remapDatabaseUrlToTestDb();
const workerDatabases = configureWorkerDatabases('syncworker');

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    fileParallelism: false, // parallel files are turned on in a separate step
    maxWorkers: testWorkers(), // inert while fileParallelism is false
    globals: false,
    environment: 'node',
    globalSetup: [workerDatabases.globalSetup],
    setupFiles: workerDatabases.setupFiles,
  },
});
