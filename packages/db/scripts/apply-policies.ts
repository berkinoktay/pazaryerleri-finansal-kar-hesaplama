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
// `pg-cron-setup.sql` is applied by the cron step below (CRON_APPLIED): the
// script creates the pg_cron extension itself (the Supabase image preloads it),
// and every scheduled job runs entirely inside Postgres so the file needs no
// per-environment configuration. CI (CI=true) skips scheduling so cron ticks
// never race the test suite; the fan-out SQL is covered by packages/sync-core's
// pg-cron-fanout integration test instead.
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

// Cron scheduling SQL — applied by the cron step below when pg_cron is
// available; skipped with a warning when it isn't, and skipped in CI so
// scheduled ticks can't fire mid-test-suite.
const CRON_APPLIED = ['pg-cron-setup.sql'] as const;

// Guard: every .sql file under supabase/sql must be classified as either
// AUTO_APPLIED or CRON_APPLIED. A newly added governance file that is neither
// fails loudly here (on the next db:push / CI run) instead of being silently
// omitted from the deploy path -- the exact "forgot to wire it up" footgun that
// would otherwise ship a table without its RLS policy.
const classified = new Set<string>([...AUTO_APPLIED, ...CRON_APPLIED]);
const unclassified = readdirSync(sqlDir)
  .filter((file) => file.endsWith('.sql'))
  .filter((file) => !classified.has(file));
if (unclassified.length > 0) {
  console.error(
    `Unclassified governance SQL in supabase/sql: ${unclassified.join(', ')}.\n` +
      `Add each to AUTO_APPLIED (applied by db:push/db:deploy) or CRON_APPLIED in apply-policies.ts.`,
  );
  process.exit(1);
}

const connectionString = process.env['DATABASE_URL'];
if (connectionString === undefined || connectionString.length === 0) {
  console.error('DATABASE_URL is required. Run with `tsx --env-file=../../.env ...`.');
  process.exit(1);
}

/**
 * Cron step: enable pg_cron, reset the retired fx-rates DB settings, then
 * schedule every job in pg-cron-setup.sql.
 *
 * Never throws — cron is additive infrastructure; a missing extension must
 * not block RLS/trigger governance from landing. The warning is loud enough
 * that an environment without cron is a visible, deliberate state.
 */
async function applyCronSetup(c: Client): Promise<void> {
  if (process.env['CI'] === 'true') {
    console.log(
      '↷ Skipped pg-cron-setup.sql (CI=true — scheduled ticks would race the test suite)',
    );
    return;
  }

  try {
    await c.query('CREATE EXTENSION IF NOT EXISTS pg_cron');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `⚠ pg_cron unavailable (${message}) — cron jobs NOT scheduled.\n` +
        `  Marketplace syncs will only run via the connect-time bootstrap and manual enqueue.\n` +
        `  Enable the extension for this database, then re-run pnpm db:apply-policies.`,
    );
    return;
  }

  // Lira-only cutover: the retired fx-rates job stored its Edge Function URL and
  // the service-role key in per-database settings. The job is gone (pg-cron-setup.sql
  // unschedules it), so RESET both settings here too — an already-configured
  // database must not keep holding the service-role key. Each RESET is guarded on
  // the setting actually being present in this database's config: resetting an
  // absent custom GUC would otherwise raise "permission denied to set parameter"
  // for a non-superuser role, and a database that never ran the old SET has
  // nothing to clear anyway. Guarded this way the step is a clean, idempotent
  // no-op where there is nothing to reset, and a real reset where the old script
  // persisted the key (the deploy role that set it can also reset it).
  await c.query(
    `DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_db_role_setting s JOIN pg_database d ON d.oid = s.setdatabase
        WHERE d.datname = current_database() AND s.setrole = 0
          AND EXISTS (SELECT 1 FROM unnest(s.setconfig) cfg WHERE cfg LIKE 'app.supabase_functions_url=%')
      ) THEN
        EXECUTE format('ALTER DATABASE %I RESET app.supabase_functions_url', current_database());
      END IF;
      IF EXISTS (
        SELECT 1 FROM pg_db_role_setting s JOIN pg_database d ON d.oid = s.setdatabase
        WHERE d.datname = current_database() AND s.setrole = 0
          AND EXISTS (SELECT 1 FROM unnest(s.setconfig) cfg WHERE cfg LIKE 'app.supabase_service_role_key=%')
      ) THEN
        EXECUTE format('ALTER DATABASE %I RESET app.supabase_service_role_key', current_database());
      END IF;
    END
    $$;`,
  );

  for (const file of CRON_APPLIED) {
    const sqlPath = path.join(sqlDir, file);
    await c.query(readFileSync(sqlPath, 'utf8'));
    console.log(`✓ Applied ${sqlPath}`);
  }
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
  await applyCronSetup(client);
} finally {
  await client.end();
}
