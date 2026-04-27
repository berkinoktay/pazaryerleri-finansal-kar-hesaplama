// One-shot cutover script for the v1 → v2 sync engine migration.
//
// Marks any sync_logs row left in RUNNING by the v1 fire-and-forget path
// (Promise inside a Hono request handler) as FAILED with errorCode
// 'MIGRATION_INTERRUPTED'. Run once after the v2 worker is deployed and
// the API route refactor (PR 4h) is live in production.
//
// Idempotent — only marks rows whose `claimed_at IS NULL` (i.e., they
// pre-date the worker, which always sets `claimed_at` on a successful
// claim). v2 RUNNING rows (claimed by a worker) are never touched, so
// running this multiple times in a row is safe.
//
// Uses `DIRECT_URL` when set (bypasses pgbouncer / Supabase pooler) and
// falls back to `DATABASE_URL` — same pattern as apply-policies.ts.
//
// Invoke from packages/db with `pnpm cutover:v2`.

import { Client } from 'pg';

const connectionString = process.env['DIRECT_URL'] ?? process.env['DATABASE_URL'];
if (connectionString === undefined || connectionString.length === 0) {
  console.error('DATABASE_URL or DIRECT_URL is required. Run with `tsx --env-file=../../.env …`.');
  process.exit(1);
}

const client = new Client({ connectionString });
await client.connect();
try {
  const result = await client.query(`
    UPDATE sync_logs SET
      status = 'FAILED',
      completed_at = now(),
      error_code = 'MIGRATION_INTERRUPTED',
      error_message = 'Run was orphaned by the v1 → v2 sync engine migration. Please retrigger.'
    WHERE status = 'RUNNING'
      AND claimed_at IS NULL
  `);
  console.log(
    `Cutover complete — ${(result.rowCount ?? 0).toString()} row(s) marked MIGRATION_INTERRUPTED`,
  );
} finally {
  await client.end();
}
