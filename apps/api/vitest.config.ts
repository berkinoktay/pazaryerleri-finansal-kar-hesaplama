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
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    // Integration tests share one Postgres DB and TRUNCATE between tests.
    // Running test files in parallel forks would race: file A's TRUNCATE
    // wipes the data file B just inserted in its beforeEach. Tests within
    // a single file still run in order, so TRUNCATE in beforeEach is safe.
    fileParallelism: false,
  },
});
