import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'vitest/config';

import { testWorkers } from '@pazarsync/vitest-config';

// RLS suite config. Runs the `tests/integration/rls/**` suite that the main
// integration config (`vitest.config.ts`) deliberately excludes.
//
// It DOES NOT remap DATABASE_URL at the isolated test DB (and ignores
// TEST_DATABASE_URL entirely, on purpose): RLS is proven through the Supabase JS
// client → PostgREST with a real GoTrue-issued JWT, and PostgREST/GoTrue/Realtime
// only ever attach to the dev "postgres" database (supabase/config.toml can't
// repoint them). So this suite is the ONE place that still runs against the dev
// DB — every other integration suite is isolated. Locally it is opt-in via
// `pnpm --filter @pazarsync/api test:integration:rls`.
//
// Because it TRUNCATEs tenant tables on whatever database it reaches, loading
// this config requires an explicit opt-in (2026-11-05: a single stray run wiped
// the dev data). CI sets it for its disposable per-job database. The check runs
// BEFORE the .env file is loaded, so the opt-in can never come from .env.
const ALLOW_DEV_DB_TRUNCATE = 'PAZARSYNC_ALLOW_DEV_DB_TRUNCATE';
if (process.env[ALLOW_DEV_DB_TRUNCATE] !== '1') {
  throw new Error(
    `Refusing to load vitest.rls.config.ts: the RLS suite TRUNCATEs the database it runs against (the dev DB locally). ` +
      `Set ${ALLOW_DEV_DB_TRUNCATE}=1 only in CI or right after a full pg_dump backup of the dev data.`,
  );
}

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, '../../.env') });

export default defineConfig({
  resolve: {
    // Mirror the `@/*` → `./src/*` alias so RLS helpers (auth.ts, rls-client.ts)
    // that import `@/lib/...` resolve at runtime.
    alias: {
      '@': path.resolve(here, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/integration/rls/**/*.test.ts'],
    // RLS tests share the one dev Postgres DB and TRUNCATE between tests, so
    // files must not run in parallel forks (a file's TRUNCATE would wipe another
    // file's setup). Same rationale as the main integration config.
    fileParallelism: false,
    maxWorkers: testWorkers(),
    // Reuse the shared globalSetup: it seeds shipping reference data and, on
    // teardown, restores the reference catalogue (fee_definitions +
    // commission rates) that RLS tests' `truncateAll` wipes on the dev DB, and
    // purges the `@test.local` auth users these tests mint.
    globalSetup: [path.resolve(here, './tests/global-teardown.ts')],
  },
});
