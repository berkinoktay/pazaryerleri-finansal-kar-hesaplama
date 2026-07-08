import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { remapDatabaseUrlToTestDb } from '@pazarsync/db/test-env';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'vitest/config';

// Local-dev convenience: pull DATABASE_URL etc. from the workspace-root .env
// so `pnpm --filter @pazarsync/sync-core test:unit` works without exporting
// env vars by hand. CI sets these via the workflow `env:` block, so a missing
// .env there is a no-op (dotenv silently skips when the file isn't found).
const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, '../../.env') });

// Redirect DATABASE_URL at the isolated test DB (see packages/db/src/test-env.ts).
// Harmless for the DB-free unit tests this same config serves (test:unit sets
// PAZARSYNC_SKIP_RESEED=1, which suppresses the remap's TEST_DATABASE_URL demand).
remapDatabaseUrlToTestDb();

export default defineConfig({
  test: {
    fileParallelism: false,
    globals: false,
    environment: 'node',
  },
});
