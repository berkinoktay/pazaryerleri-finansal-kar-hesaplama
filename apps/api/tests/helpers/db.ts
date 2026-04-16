import { prisma } from '@pazarsync/db';

export { prisma };

/**
 * Truncate all tenant-scoped tables, resetting sequences.
 *
 * Call in `beforeEach` for any test that touches the DB. CASCADE handles
 * any FKs we forgot to enumerate. RESTART IDENTITY resets auto-increment
 * sequences so test data is deterministic.
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
       organizations,
       user_profiles
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
