import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { configureWorkerDatabases, remapDatabaseUrlToTestDb } from '@pazarsync/db/test-env';
import { config as loadEnv } from 'dotenv';
import { configDefaults, defineConfig } from 'vitest/config';

import { testWorkers } from '@pazarsync/vitest-config';

// Local-dev convenience: pull DATABASE_URL etc. from the workspace-root .env
// so `pnpm --filter @pazarsync/api test` works without exporting env vars by
// hand. CI sets these via the workflow `env:` block, so a missing .env there
// is a no-op (dotenv silently skips when the file isn't found).
const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, '../../.env') });

// Integration-only config (tests/integration/**). DB-free unit tests have their
// own vitest.unit.config.ts, which runs files in parallel.
// Redirect DATABASE_URL at the isolated test DB (see packages/db/src/test-env.ts),
// then give every worker its own clone of it (packages/db/src/test-db-clones.ts).
remapDatabaseUrlToTestDb();
const workerDatabases = configureWorkerDatabases('api');

export default defineConfig({
  resolve: {
    // Mirror the `@/*` → `./src/*` alias declared in tsconfig.json so
    // tests can import `@/lib/errors` instead of `../../../src/lib/errors`.
    // The tsconfig `paths` entry only affects type checking; Vite/Vitest
    // runtime resolution needs this explicit mapping.
    alias: {
      '@': path.resolve(here, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    // The RLS suite is deliberately excluded here and run via its own config
    // (`vitest.rls.config.ts`, script `test:integration:rls`). RLS tests exercise
    // policies through PostgREST/GoTrue, which only serve the dev "postgres" DB,
    // so they must NOT be remapped at the isolated test DB like everything else.
    exclude: [...configDefaults.exclude, 'tests/integration/rls/**'],
    // Integration tests share one Postgres DB and TRUNCATE between tests.
    // Each worker has its own database clone, but files still run one at a
    // time for now: parallel files are turned on in a separate step.
    fileParallelism: false,
    // Pool size from the shared policy (@pazarsync/vitest-config). Inert while
    // fileParallelism is false (vitest forces one worker). Importing the policy
    // still matters here: it deletes VITEST_MAX_WORKERS, which would otherwise
    // override fileParallelism:false.
    maxWorkers: testWorkers(),
    // Clone the template once per worker (first), then the dev-DB auth purge.
    globalSetup: [
      workerDatabases.globalSetup,
      path.resolve(here, './tests/integration-global-setup.ts'),
    ],
    // Points each worker's DATABASE_URL at its clone before any test imports Prisma.
    setupFiles: workerDatabases.setupFiles,
  },
});
