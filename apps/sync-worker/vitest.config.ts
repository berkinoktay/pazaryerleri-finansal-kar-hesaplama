import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'vitest/config';

// Local-dev convenience: pull DATABASE_URL etc. from the workspace-root .env
// so `pnpm --filter @pazarsync/sync-worker test:integration` works without
// exporting env vars by hand. CI sets these via the workflow `env:` block,
// so a missing .env there is a no-op (dotenv silently skips when the file
// isn't found).
const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, '../../.env') });

export default defineConfig({
  test: {
    fileParallelism: false, // integration tests share one DB
    globals: false,
    environment: 'node',
    // Seed the shipping reference fixture once (carriers + tariffs) so the claims
    // return-estimate handler can look up the seeded SENDEOMP carrier. Read-only
    // fixture, never truncated. Skipped on unit-only runs via PAZARSYNC_SKIP_RESEED.
    globalSetup: [path.resolve(here, './tests/global-setup.ts')],
  },
});
