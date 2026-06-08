// Applies governance SQL (RLS policies, DB functions, triggers, check
// constraints, realtime publications) to a target database.
//
//   - Dev:  chained into `pnpm db:push` so schema + governance land together.
//           CI's integration-test job runs `pnpm db:push` for the same effect.
//   - Prod: chained into `pnpm db:deploy` (`prisma migrate deploy` then this),
//           so a production cutover applies RLS as part of the deploy and never
//           ships tenant tables without row-level security.
//
// Files are applied in order (functions before the triggers that call them);
// each is itself idempotent (DROP ... IF EXISTS, ON CONFLICT ... DO NOTHING),
// so re-running -- and running against prod after dev -- is safe.
//
// `pg-cron-setup.sql` is intentionally NOT auto-applied (see MANUAL_ONLY): it
// needs the pg_cron + pg_net extensions enabled in the Supabase Dashboard and
// carries env-specific placeholders (<SUPABASE_PROJECT_REF> + a vault
// service-role key), so it is applied by hand per environment at launch -- see
// that file's header for the procedure.
//
// Uses `pg` directly rather than shelling to `psql` because `psql` is an
// optional system dep; `pg` is already a workspace dep and works anywhere Node does.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlDir = path.resolve(__dirname, '../../../supabase/sql');

// Governance SQL applied automatically by db:push (dev) and db:deploy (prod).
const AUTO_APPLIED = [
  'db-functions.sql',
  'rls-policies.sql',
  'triggers.sql',
  'check-constraints.sql',
  'realtime-publications.sql',
] as const;

// Governance SQL applied MANUALLY, per environment, never by db:push/db:deploy.
// See the note above + the file headers for why each one cannot run unattended.
const MANUAL_ONLY = ['pg-cron-setup.sql'] as const;

// Guard: every .sql file under supabase/sql must be classified as either
// AUTO_APPLIED or MANUAL_ONLY. A newly added governance file that is neither
// fails loudly here (on the next db:push / CI run) instead of being silently
// omitted from the deploy path -- the exact "forgot to wire it up" footgun that
// would otherwise ship a table without its RLS policy.
const classified = new Set<string>([...AUTO_APPLIED, ...MANUAL_ONLY]);
const unclassified = readdirSync(sqlDir)
  .filter((file) => file.endsWith('.sql'))
  .filter((file) => !classified.has(file));
if (unclassified.length > 0) {
  console.error(
    `Unclassified governance SQL in supabase/sql: ${unclassified.join(', ')}.\n` +
      `Add each to AUTO_APPLIED (applied by db:push/db:deploy) or MANUAL_ONLY in apply-policies.ts.`,
  );
  process.exit(1);
}

const connectionString = process.env['DATABASE_URL'];
if (connectionString === undefined || connectionString.length === 0) {
  console.error('DATABASE_URL is required. Run with `tsx --env-file=../../.env ...`.');
  process.exit(1);
}

const client = new Client({ connectionString });
await client.connect();
try {
  for (const file of AUTO_APPLIED) {
    const sqlPath = path.join(sqlDir, file);
    const sql = readFileSync(sqlPath, 'utf8');
    await client.query(sql);
    console.log(`✓ Applied ${sqlPath}`);
  }
} finally {
  await client.end();
}
