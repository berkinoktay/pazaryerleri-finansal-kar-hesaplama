/**
 * Shared test-support: global reference-data fixture seeding (shipping catalogue +
 * micro-export return-fee tiers).
 *
 * The shipping reference tables (`shipping_carriers`, `shipping_tariff_versions`,
 * `shipping_desi_tariffs`, `shipping_barem_tariffs`) are a READ-ONLY global
 * fixture, not tenant data: the same rows service every seller and the live app
 * reads them on every ORDERS/cargo sync. The test DB is built with
 * `prisma db push`, which creates empty tables, so this helper runs the marked
 * seed section of the reference-seed files at test time:
 * `20261121090000_shipping_tariff_versions.sql` (carriers, one dated version per
 * carrier, that version's desi and Barem rows) and
 * `20261121090100_micro_export_return_fee_tier_versions.sql` (the micro-export
 * tier version and its tiers). The same files feed `pnpm db:seed-reference`, so
 * the test DB and the dev DB share one source.
 *
 * It lives in `@pazarsync/db` (next to the seed files it reads) so every
 * integration package — apps/api, apps/sync-worker, packages/profit — imports
 * it the same way (`@pazarsync/db/test-support`) and runs it in `globalSetup`,
 * starting from the same baseline regardless of cross-package run order.
 *
 * NO test may TRUNCATE or write these tables — they are a fixture, never
 * tenant data (enforced by `scripts/audit-test-reference-hygiene.ts`). Tests
 * that need a carrier look up a seeded one by code (e.g. `SENDEOMP`).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

import { prisma } from './index';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SHIPPING_SEED_SQL_PATH = resolve(
  __dirname,
  '../prisma/reference-seed/20261121090000_shipping_tariff_versions.sql',
);

const MICRO_RETURN_TIER_SEED_SQL_PATH = resolve(
  __dirname,
  '../prisma/reference-seed/20261121090100_micro_export_return_fee_tier_versions.sql',
);

const EXPECTED_CARRIER_COUNT = 10;
const SEED_SECTION_MARKER = '-- ─── Seed: shipping_tariff_versions';
const MICRO_RETURN_TIER_SEED_MARKER = '-- ─── Seed: micro_export_return_fee_tier_versions';

let cachedSeedSql: string | null = null;
let cachedMicroReturnTierSeedSql: string | null = null;

function loadSeedSql(): string {
  if (cachedSeedSql !== null) return cachedSeedSql;
  const full = readFileSync(SHIPPING_SEED_SQL_PATH, 'utf-8');
  const seedStart = full.indexOf(SEED_SECTION_MARKER);
  if (seedStart === -1) {
    throw new Error(
      `Could not find shipping seed section ("${SEED_SECTION_MARKER}") in ${SHIPPING_SEED_SQL_PATH}. ` +
        'If the seed file was renamed or restructured, update SHIPPING_SEED_SQL_PATH / SEED_SECTION_MARKER here.',
    );
  }
  cachedSeedSql = full.substring(seedStart);
  return cachedSeedSql;
}

function loadMicroReturnTierSeedSql(): string {
  if (cachedMicroReturnTierSeedSql !== null) return cachedMicroReturnTierSeedSql;
  const full = readFileSync(MICRO_RETURN_TIER_SEED_SQL_PATH, 'utf-8');
  const seedStart = full.indexOf(MICRO_RETURN_TIER_SEED_MARKER);
  if (seedStart === -1) {
    throw new Error(
      `Could not find micro-export return tier seed section ("${MICRO_RETURN_TIER_SEED_MARKER}") ` +
        `in ${MICRO_RETURN_TIER_SEED_SQL_PATH}.`,
    );
  }
  cachedMicroReturnTierSeedSql = full.substring(seedStart);
  return cachedMicroReturnTierSeedSql;
}

/**
 * Seeds the micro-export "Yurt Disi Iade Operasyon Bedeli" tier version and its
 * tiers from the seed file's marked section (single source of truth). Global
 * reference fixture (not tenant data); truncateAll() never touches it. Idempotent
 * (ON CONFLICT DO NOTHING in the SQL); seeds only when the table is empty.
 */
export async function ensureMicroExportReturnTiers(): Promise<void> {
  const count = await prisma.microExportReturnFeeTier.count();
  if (count > 0) return;
  await prisma.$executeRawUnsafe(loadMicroReturnTierSeedSql());
}

/**
 * Brings the shipping reference catalogue to the EXACT seed baseline:
 *   - clean (exactly 10 carriers, none test-created) → fast no-op;
 *   - dirty (a stray `TEST%` carrier left by another suite, or an empty
 *     catalogue) → prune the strays, then seed the canonical rows if missing.
 *
 * This is the structural guard behind `list-carriers`' "exactly 10" assertion:
 * leakage from any source can no longer poison the count. Idempotent.
 */
export async function ensureShippingReferenceData(): Promise<void> {
  const [total, strays] = await Promise.all([
    prisma.shippingCarrier.count(),
    prisma.shippingCarrier.count({ where: { code: { startsWith: 'TEST' } } }),
  ]);

  // Clean baseline (exactly the seeded carriers, no test strays) → nothing to do.
  if (total === EXPECTED_CARRIER_COUNT && strays === 0) return;

  // Prune test-created strays. Their tariff versions, and through them the
  // versions' desi/Barem rows, cascade (FK onDelete: Cascade), and any store
  // pointing at one resolves via ON DELETE SET NULL, so DELETE (not TRUNCATE)
  // never cascade-wipes tenant rows. Only the canonical carriers survive.
  if (strays > 0) {
    await prisma.$executeRawUnsafe(`DELETE FROM shipping_carriers WHERE code LIKE 'TEST%'`);
  }

  // Seed the canonical catalogue if it is missing. The seed section contains
  // four statements (carriers, one version per carrier, desi rows and Barem rows,
  // the last three joined to the rows before them). pg accepts semicolon-separated
  // multi-statement input through executeRawUnsafe; statements run in order so
  // each JOIN sees the rows just inserted. Canonical carriers are never deleted
  // individually, so the count here is either 0 (seed) or already
  // EXPECTED_CARRIER_COUNT (skip) — never partial.
  const canonical = await prisma.shippingCarrier.count();
  if (canonical < EXPECTED_CARRIER_COUNT) {
    await prisma.$executeRawUnsafe(loadSeedSql());
  }
}

/**
 * Purge GoTrue-minted `@test.local` auth users (and the orphan `user_profiles`
 * rows the `on_auth_user_created` trigger leaves behind) from a target DB via a
 * short-lived `pg` connection — NOT the Prisma singleton.
 *
 * Integration tests bind Prisma to the ISOLATED test DB, but GoTrue is wired to
 * the "postgres" (dev) database and cannot be pointed elsewhere, so every
 * `createAuthenticatedTestUser` call mints a real `auth.users` row THERE and the
 * dev-DB trigger inserts a matching `public.user_profiles` orphan. Neither is
 * reachable through the test-DB singleton, so the apps/api global teardown calls
 * this with the dev connection string to keep the dev DB from accumulating test
 * residue (it once hit ~35k rows).
 *
 * Both deletes are flat `email LIKE '%@test.local'` DELETEs, NOT join-based
 * orphan detection: the dev-DB `user_profiles` row is pure residue of the mint's
 * dual write (GoTrue INSERT on `auth.users` → the trigger's `user_profiles`
 * INSERT), so the `@test.local` pattern alone identifies it. The pattern also
 * spares real logins (gmail, `demo@pazarsync.local`). `user_profiles` has no FK
 * to `auth.users`, and the tenant TRUNCATE that runs before this already cleared
 * `organization_members`, so the profile delete is childless and order-independent.
 */
export async function purgeLeakedTestAuthUsers(
  connectionString: string,
): Promise<{ authUsers: number; profiles: number }> {
  const client = new pg.Client({ connectionString });
  // Track connection state so a `connect()` failure still flows through the
  // finally without calling `end()` on a client that never connected.
  let connected = false;
  try {
    await client.connect();
    connected = true;
    const users = await client.query(`DELETE FROM auth.users WHERE email LIKE '%@test.local'`);
    const profiles = await client.query(
      `DELETE FROM public.user_profiles WHERE email LIKE '%@test.local'`,
    );
    return { authUsers: users.rowCount ?? 0, profiles: profiles.rowCount ?? 0 };
  } finally {
    if (connected) await client.end();
  }
}
