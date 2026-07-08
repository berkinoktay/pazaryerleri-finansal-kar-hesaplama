import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'vitest/config';

import { remapDatabaseUrlToTestDb } from './src/test-env';

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, '../../.env') });

// Redirect DATABASE_URL at the isolated test DB. Own-package import goes through
// the relative path (self-referencing '@pazarsync/db/test-env' would be
// needlessly indirect here). schema-gross.test.ts builds its own pg Pool from
// DATABASE_URL, so the remap covers it too.
remapDatabaseUrlToTestDb();

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
  },
});
