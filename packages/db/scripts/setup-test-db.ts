// Bootstrap the ISOLATED integration-test database.
//
// The integration suite TRUNCATEs ~29 tenant + reference tables in `beforeEach`.
// Running that against the shared dev DB wipes a developer's working data, so
// vitest is remapped (see packages/db/src/test-env.ts) at a SECOND logical
// database on the SAME local Supabase Postgres server (no extra container).
//
// This script creates and prepares that DB idempotently:
//   1. CREATE DATABASE <name> on the dev server (if missing).
//   2. Apply a minimal Supabase shim the governance SQL + auth helpers need
//      (auth schema, auth.uid(), a stub auth.users, the supabase_realtime
//      publication) — the local Supabase services (PostgREST/GoTrue/Realtime)
//      only ever attach to the "postgres" DB, so this DB has none of them.
//   3. `prisma db push` → apply-policies → seed:reference, each with
//      DATABASE_URL overridden to the test DB.
//
// Run with: `pnpm db:test-setup`. Safe to re-run (every step is idempotent).

import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';

import { extractDbName } from '../src/test-env';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(__dirname, '..'); // packages/db

// Load the workspace-root .env for DATABASE_URL (dev) + TEST_DATABASE_URL.
// dotenv never overrides an already-set process.env var, so exported values win.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const SETUP_INSTRUCTIONS =
  'Set TEST_DATABASE_URL in your workspace-root .env, e.g.\n' +
  '  TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/pazarsync_test\n' +
  'Then re-run `pnpm db:test-setup`.';

/** CREATE DATABASE on the dev server if it does not already exist. */
async function ensureDatabaseExists(devUrl: string, dbName: string): Promise<boolean> {
  const client = new Client({ connectionString: devUrl });
  await client.connect();
  try {
    const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (rows.length > 0) return false;
    // dbName is validated above (never "postgres"); still quote defensively —
    // CREATE DATABASE cannot be parameterized.
    await client.query(`CREATE DATABASE ${client.escapeIdentifier(dbName)}`);
    return true;
  } finally {
    await client.end();
  }
}

/**
 * Apply the minimal Supabase surface the governance SQL depends on. Idempotent:
 * IF NOT EXISTS / CREATE OR REPLACE / a pg_publication guard, so re-runs are
 * clean. Intentionally NOT a faithful GoTrue schema — just enough for
 * triggers.sql (CREATE TRIGGER ON auth.users), rls-policies.sql (auth.uid()),
 * realtime-publications.sql (supabase_realtime), and the teardown auth purge.
 */
async function applySupabaseShim(testUrl: string): Promise<void> {
  const client = new Client({ connectionString: testUrl });
  await client.connect();
  try {
    await client.query('CREATE SCHEMA IF NOT EXISTS auth');
    // Matches Supabase's auth.uid(): read the `sub` claim off the request JWT.
    // On this DB no PostgREST sets request.jwt.claims, so it returns NULL —
    // which is correct: the postgres superuser (Prisma) bypasses RLS anyway.
    await client.query(
      `CREATE OR REPLACE FUNCTION auth.uid()
       RETURNS uuid
       LANGUAGE sql
       STABLE
       AS $$
         SELECT NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid
       $$`,
    );
    // Stub auth.users: just enough for triggers.sql's CREATE TRIGGER and the
    // teardown DELETE. Not GoTrue's real table (no rows are ever written here
    // in the test-DB path — GoTrue writes the dev "postgres" DB).
    await client.query(
      `CREATE TABLE IF NOT EXISTS auth.users (
         id uuid PRIMARY KEY,
         email text
       )`,
    );
    // CREATE PUBLICATION has no IF NOT EXISTS form — guard on pg_publication.
    await client.query(
      `DO $$
       BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
           CREATE PUBLICATION supabase_realtime;
         END IF;
       END $$`,
    );
  } finally {
    await client.end();
  }
}

/** Run a child step against the test DB, echoing the tail of its output. */
async function runStep(
  label: string,
  file: string,
  args: string[],
  childEnv: NodeJS.ProcessEnv,
): Promise<string> {
  const { stdout, stderr } = await execFileAsync(file, args, { cwd: packageDir, env: childEnv });
  const tail = stdout.trim().split('\n').slice(-3).join('\n');
  if (stderr.trim() !== '') console.warn(`[${label}] stderr:\n${stderr.trim()}`);
  return tail;
}

const testUrl = process.env['TEST_DATABASE_URL'];
if (testUrl === undefined || testUrl.length === 0) {
  console.error(`TEST_DATABASE_URL is required.\n${SETUP_INSTRUCTIONS}`);
  process.exit(1);
}

const devUrl = process.env['DATABASE_URL'];
if (devUrl === undefined || devUrl.length === 0) {
  console.error('DATABASE_URL (the dev DB used to CREATE the test DB) is required in .env.');
  process.exit(1);
}

const dbName = extractDbName(testUrl);
if (dbName === '') {
  console.error(`Could not parse a database name from TEST_DATABASE_URL.\n${SETUP_INSTRUCTIONS}`);
  process.exit(1);
}
if (dbName === 'postgres') {
  console.error(
    'Refusing to run: TEST_DATABASE_URL points at the "postgres" database, which is the ' +
      'shared dev DB. The isolated test DB must be a SEPARATE database (e.g. pazarsync_test).\n' +
      SETUP_INSTRUCTIONS,
  );
  process.exit(1);
}

const created = await ensureDatabaseExists(devUrl, dbName);
await applySupabaseShim(testUrl);

const childEnv: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: testUrl,
  DIRECT_URL: testUrl,
};

// Apply the Prisma schema to the test DB. `--url` overrides the datasource from
// prisma.config.ts explicitly (no reliance on env/dotenv precedence). Prisma 7's
// `db push` has no `--skip-generate` flag; a redundant client regenerate is
// harmless (the client is gitignored and rebuilt from the same schema anyway).
const pushOut = await runStep(
  'db push',
  'pnpm',
  ['exec', 'prisma', 'db', 'push', '--url', testUrl],
  childEnv,
);

// Invoke apply-policies via tsx directly (NOT the pnpm script, which prepends
// `--env-file` and would reload the dev .env over our childEnv override).
const policiesOut = await runStep(
  'policies',
  'pnpm',
  ['exec', 'tsx', 'scripts/apply-policies.ts'],
  childEnv,
);

// seed-reference.ts loads .env via dotenv (non-overriding), so childEnv wins.
const seedOut = await runStep(
  'seed:reference',
  'pnpm',
  ['exec', 'tsx', 'scripts/seed-reference.ts'],
  childEnv,
);

console.log('\n=== Test DB setup complete ===');
console.log(`Database: ${dbName} (${created ? 'created' : 'already existed'})`);
console.log(`Schema push:\n${pushOut}`);
console.log(`Policies (RLS/triggers/functions/constraints/realtime):\n${policiesOut}`);
console.log(`Reference seed:\n${seedOut}`);
