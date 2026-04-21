import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'vitest/config';

// Local-dev convenience: pull DATABASE_URL etc. from the workspace-root .env
// so `pnpm --filter @pazarsync/api test` works without exporting env vars by
// hand. CI sets these via the workflow `env:` block, so a missing .env there
// is a no-op (dotenv silently skips when the file isn't found).
const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, '../../.env') });

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
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    // Integration tests share one Postgres DB and TRUNCATE between tests.
    // Running test files in parallel forks would race: file A's TRUNCATE
    // wipes the data file B just inserted in its beforeEach. Tests within
    // a single file still run in order, so TRUNCATE in beforeEach is safe.
    fileParallelism: false,
    // After the whole vitest run completes, restore seed data so the
    // developer's browser session (logged in as berkin / demo) sees the
    // usual orgs and stores instead of an empty state. Skipped in CI and
    // when PAZARSYNC_SKIP_RESEED=1 (set by `test:unit` — no DB touched).
    // vitest uses the `globalSetup` hook; the file exports `setup` (no-op)
    // and a `teardown` that shells out to `pnpm db:seed`.
    globalSetup: [path.resolve(here, './tests/global-teardown.ts')],
  },
});
