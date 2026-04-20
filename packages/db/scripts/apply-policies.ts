// Applies governance SQL (RLS policies + triggers) to the local dev DB.
//
// Chained into `pnpm db:push` so schema changes and governance land
// together — no "forgot to re-run" footgun. In CI, the integration test
// job runs `pnpm db:push` for the same effect.
//
// Files are applied in order; each file is itself idempotent (uses
// DROP … IF EXISTS and ON CONFLICT … DO NOTHING), so re-running is safe.
//
// Uses `pg` directly rather than shelling to `psql` because `psql` is
// an optional system dep; `pg` is already a workspace dep and works
// anywhere Node does.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlDir = path.resolve(__dirname, '../../../supabase/sql');
const FILES = ['rls-policies.sql', 'triggers.sql'] as const;

const connectionString = process.env['DATABASE_URL'];
if (connectionString === undefined || connectionString.length === 0) {
  console.error('DATABASE_URL is required. Run with `tsx --env-file=../../.env …`.');
  process.exit(1);
}

const client = new Client({ connectionString });
await client.connect();
try {
  for (const file of FILES) {
    const sqlPath = path.join(sqlDir, file);
    const sql = readFileSync(sqlPath, 'utf8');
    await client.query(sql);
    console.log(`\u2713 Applied ${sqlPath}`);
  }
} finally {
  await client.end();
}
