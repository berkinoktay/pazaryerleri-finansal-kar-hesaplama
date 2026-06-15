// `db:reset:clean` — wipe the dev DB to a true blank baseline for GROSS convention.
//
// TRUNCATEs every application table (tenant + catalog + account + reference),
// purges leaked `@test.local` auth users, then re-creates `user_profiles` rows
// for the auth users that survive — leaving the schema intact but empty.
// After this, re-connect the store from the UI → bootstrap re-sync
// (products → orders → settlements) rebuilds everything under GROSS convention.
//
// The table set is DISCOVERED dynamically from the catalog (every public table
// except Prisma's migration bookkeeping), so the wipe never drifts as the schema
// grows — no hand-maintained list to keep in sync with `truncateAll`.
//
// Uses `pg` directly (psql is an optional system dep; pg is a workspace dep).
import { Client } from 'pg';

const connectionString = process.env['DATABASE_URL'];
if (connectionString === undefined || connectionString.length === 0) {
  console.error('DATABASE_URL is required. Run with `pnpm db:reset:clean` (loads .env).');
  process.exit(1);
}

const client = new Client({ connectionString });
await client.connect();
try {
  const { rows } = await client.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
     ORDER BY tablename`,
  );
  const tables = rows.map((row) => row.tablename);

  if (tables.length > 0) {
    // Identifiers come from the catalog (not user input); quote them and let
    // CASCADE handle FK order in one statement.
    const quoted = tables.map((name) => `"${name}"`).join(', ');
    await client.query(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
  }
  console.log(`✓ Truncated ${tables.length} public table(s) (tenant + catalog + reference)`);

  const purged = await client.query(`DELETE FROM auth.users WHERE email LIKE '%@test.local'`);
  console.log(`✓ Purged ${purged.rowCount ?? 0} test auth user(s)`);

  // Re-create user_profiles for the surviving auth.users. The TRUNCATE above
  // emptied public.user_profiles, but the `handle_new_user` trigger fires ONLY
  // on an auth.users INSERT — it never backfills users that already exist. So a
  // returning developer (whose auth account survives) is left profile-less and
  // hits 422 INVALID_REFERENCE on org creation (the org-membership FK has no
  // profile to point at). Mirror the trigger's columns exactly (id, email,
  // updated_at); created_at / timezone / preferred_language use their DB
  // defaults. Idempotent via ON CONFLICT so re-running never errors.
  const profiles = await client.query(
    `INSERT INTO public.user_profiles (id, email, updated_at)
     SELECT id, email, now() FROM auth.users
     ON CONFLICT (id) DO NOTHING`,
  );
  console.log(`✓ Recreated ${profiles.rowCount ?? 0} user profile(s) for surviving auth user(s)`);

  console.log(
    '✓ Blank baseline ready. Next: `pnpm db:seed` (minimal login), then re-sync products before testing orders.',
  );
} finally {
  await client.end();
}
