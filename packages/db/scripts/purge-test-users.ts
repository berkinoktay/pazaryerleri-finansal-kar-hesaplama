// One-shot purge of leaked test auth users from a bloated dev DB.
//
// `createAuthenticatedTestUser` mints real Supabase `auth.users` rows
// (`test-<uuid>@test.local`) and the `createUserProfile` factory uses
// `<uuid>@test.local`. `truncateAll` never touches `auth.users`
// (feedback_tests_dont_wipe_seed), so without cleanup they accumulate
// unboundedly (hit ~35k once). The integration global-teardown now purges them
// per run; this script cleans a DB that bloated before that landed, or any time
// you want a one-shot sweep.
//
// Pattern-scoped to `@test.local` → real logins (gmail, `demo@pazarsync.local`)
// are never matched.
//
// Uses `pg` directly (psql is an optional system dep; pg is a workspace dep).
import { Client } from 'pg';

const connectionString = process.env['DATABASE_URL'];
if (connectionString === undefined || connectionString.length === 0) {
  console.error('DATABASE_URL is required. Run with `pnpm db:purge-test-users` (loads .env).');
  process.exit(1);
}

const client = new Client({ connectionString });
await client.connect();
try {
  const result = await client.query(`DELETE FROM auth.users WHERE email LIKE '%@test.local'`);
  console.log(`✓ Purged ${result.rowCount ?? 0} test auth user(s) (email LIKE '%@test.local')`);
} finally {
  await client.end();
}
