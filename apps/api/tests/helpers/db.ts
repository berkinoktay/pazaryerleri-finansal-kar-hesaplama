import { prisma } from '@pazarsync/db';

export { prisma };

/**
 * Truncate all tenant-scoped tables, resetting sequences.
 *
 * Call in `beforeEach` for any test that touches the DB. CASCADE handles
 * any FKs we forgot to enumerate. RESTART IDENTITY resets auto-increment
 * sequences so test data is deterministic.
 *
 * **Does NOT touch `auth.users` OR `user_profiles`.**
 *
 * Earlier revisions truncated `auth.users` and wiped the login-capable
 * seed users; that bug was fixed.  The same trap survived for
 * `user_profiles`: integration runs would CASCADE through the
 * `on_auth_user_created` trigger's row, leaving any developer who had
 * signed up via the browser with an `auth.users` entry but no profile.
 * Org creation then 422s with P2003 because
 * `organization_members.user_id` is FK'd to `user_profiles(id)`
 * (not `auth.users.id`); the orphan auth user can never enroll itself
 * back without a manual backfill.
 *
 * Profile collision avoidance for tests is handled by
 * `createAuthenticatedTestUser` and `createUserProfile` which generate
 * random UUIDs/emails — their rows safely coexist with accumulated
 * dev profiles.  Profile accumulation is harmless locally and absent
 * in CI (ephemeral Supabase per job).
 *
 * Order doesn't matter for TRUNCATE CASCADE — Postgres figures out the FK
 * dependency graph itself.
 */
export async function truncateAll(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE
       sync_logs,
       settlement_items,
       settlements,
       order_items,
       orders,
       products,
       expenses,
       stores,
       organization_members,
       organizations
     RESTART IDENTITY CASCADE`,
  );
}

/**
 * Verify the DB is reachable. Used in test setup to fail fast with a clear
 * message when developers forgot to start Supabase local.
 */
export async function ensureDbReachable(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    throw new Error(
      `Cannot reach test database at DATABASE_URL=${process.env['DATABASE_URL']}. ` +
        `Run \`supabase start\` and \`pnpm db:push\` before integration tests. ` +
        `Original error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
