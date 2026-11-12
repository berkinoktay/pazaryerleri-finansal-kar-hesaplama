import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { remapDatabaseUrlToTestDb } from '@pazarsync/db/test-env';
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
// Redirect DATABASE_URL at the isolated test DB (see packages/db/src/test-env.ts).
remapDatabaseUrlToTestDb();

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
    // Running test files in parallel forks would race: file A's TRUNCATE
    // wipes the data file B just inserted in its beforeEach. Tests within
    // a single file still run in order, so TRUNCATE in beforeEach is safe.
    fileParallelism: false,
    // Pool size from the shared policy (@pazarsync/vitest-config). Inert while
    // fileParallelism is false (vitest forces one worker). Importing the policy
    // still matters here: it deletes VITEST_MAX_WORKERS, which would otherwise
    // override fileParallelism:false and let files race on the shared DB.
    maxWorkers: testWorkers(),
    // After the whole vitest run completes, restore seed data so the
    // developer's browser session (logged in as berkin / demo) sees the
    // usual orgs and stores instead of an empty state. Skipped in CI and
    // when PAZARSYNC_SKIP_RESEED=1.
    // vitest uses the `globalSetup` hook; the file exports `setup` (no-op)
    // and a `teardown` that shells out to `pnpm db:seed`.
    globalSetup: [path.resolve(here, './tests/global-teardown.ts')],
  },
});
