import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Load the workspace-root .env regardless of the cwd Prisma is invoked
// from. `pnpm --filter @pazarsync/db push` runs from packages/db; the
// default `import 'dotenv/config'` resolves .env relative to cwd and
// therefore misses the workspace-root file entirely.
const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, '../../.env') });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_URL'],
  },
});
