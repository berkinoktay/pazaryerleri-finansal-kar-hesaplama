import { prisma } from '@pazarsync/db';

import { resetAuthUserPoolCursor } from './auth-pool-cursor';

export { prisma };

/**
 * Tenant-scoped tables truncated between tests. Order is irrelevant — TRUNCATE
 * CASCADE resolves the FK dependency graph itself — so this is just the set of
 * tables a test may dirty. Kept as a constant so `truncateAll` can both probe
 * fullness and build the TRUNCATE from the same source.
 *
 * Deliberately excludes `auth.users` AND `user_profiles`. Earlier revisions
 * truncated `auth.users` and wiped the login-capable seed users; that bug was
 * fixed. The same trap survived for `user_profiles`: integration runs would
 * CASCADE through the `on_auth_user_created` trigger's row, leaving any
 * developer who had signed up via the browser with an `auth.users` entry but no
 * profile. Org creation then 422s with P2003 because
 * `organization_members.user_id` is FK'd to `user_profiles(id)` (not
 * `auth.users.id`); the orphan auth user can never enroll itself back without a
 * manual backfill. Keeping `auth.users` out of scope is also what lets
 * `createAuthenticatedTestUser` reuse a pooled user across tests.
 */
const TENANT_TABLES = [
  'catalog_barcode_miss',
  'live_performance_buffer',
  'webhook_events',
  'sync_logs',
  'settlement_items',
  'settlements',
  'order_claim_items',
  'order_claims',
  'order_fees',
  'org_period_fees',
  'commission_invoices',
  'order_item_cost_snapshot_components',
  'order_items',
  'orders',
  'product_variant_cost_profiles',
  'product_images',
  'product_variants',
  'products',
  'cost_profile_versions',
  'cost_profiles',
  'fx_rates',
  'expenses',
  'own_shipping_tariffs',
  'member_store_access',
  'stores',
  'organization_members',
  'organizations',
  'marketplace_commission_rate',
  'fee_definitions',
] as const;

/**
 * Truncate the tenant-scoped tables that actually hold rows, resetting their
 * sequences.
 *
 * Call in `beforeEach` for any test that touches the DB. CASCADE handles any
 * FKs we forgot to enumerate. RESTART IDENTITY resets auto-increment sequences.
 *
 * **Only non-empty tables are truncated.** A blanket TRUNCATE over the whole
 * list was profiled at ~283ms × ~788 calls ≈ 55% of the entire integration
 * suite, yet a typical test dirties only 5–10 of these ~30 tables — truncating
 * an empty table is cleanup nobody bought. So we first run ONE round-trip
 * fullness probe (`SELECT '<table>' WHERE EXISTS (SELECT 1 FROM "<table>" …)`
 * UNION-ALL'd across the list — exact, never a `pg_stat` estimate, which lags
 * VACUUM and could miss a table a test just filled) and TRUNCATE only what came
 * back. An empty probe means the DB is already clean, so we skip TRUNCATE
 * entirely.
 *
 * CASCADE may additionally empty dependent tables that fell outside the
 * non-empty set — harmless: they are all in `TENANT_TABLES` anyway, and a child
 * cannot hold rows while its parent is empty, so nothing is left behind.
 *
 * Skipping a table's TRUNCATE never leaves a sequence un-reset, because every
 * PK in these tables is a UUID — the schema has no autoincrement/serial columns
 * for `RESTART IDENTITY` to touch.
 *
 * Does NOT touch `auth.users` OR `user_profiles` (see `TENANT_TABLES`).
 */
export async function truncateAll(): Promise<void> {
  const fullnessProbe = TENANT_TABLES.map(
    (table) => `SELECT '${table}' AS t WHERE EXISTS (SELECT 1 FROM "${table}")`,
  ).join(' UNION ALL ');
  const nonEmpty = await prisma.$queryRawUnsafe<Array<{ t: string }>>(fullnessProbe);

  if (nonEmpty.length > 0) {
    const targets = nonEmpty.map((row) => `"${row.t}"`).join(', ');
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${targets} RESTART IDENTITY CASCADE`);
  }

  // `truncateAll` is the de-facto per-test boundary (every DB test calls it in
  // `beforeEach`), so rewind the reusable auth-user pool here — always, even
  // when nothing was truncated. See tests/helpers/auth-pool-cursor.ts.
  resetAuthUserPoolCursor();
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
