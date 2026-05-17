/**
 * Ensures shipping reference data (carriers + desi tariffs + Barem tariffs)
 * exists in the test database.
 *
 * Why this exists: CI runs `prisma db push` to sync the schema, which does
 * NOT execute migration SQL — so the seed INSERTs that live inside
 * `migrations/20260517085409_shipping_tariffs/migration.sql` never run.
 * Locally we use `prisma migrate dev` so the seed lands automatically and
 * tests pass; in CI the same tests previously failed with "expected []
 * to have length of 10 but got 0" because shipping_carriers was empty.
 *
 * Resolution: read the migration's seed section at test time and execute
 * it. Single source of truth (the migration file), and the function is
 * idempotent — if 10 carriers already exist (local dev case), it's a
 * no-op. The shipping reference tables are intentionally NOT in
 * `truncateAll`'s wipe list, so calling this once per test file (via
 * `beforeAll`) is enough.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { prisma } from '@pazarsync/db';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MIGRATION_SQL_PATH = resolve(
  __dirname,
  '../../../../packages/db/prisma/migrations/20260517085409_shipping_tariffs/migration.sql',
);

const EXPECTED_CARRIER_COUNT = 10;
const SEED_SECTION_MARKER = '-- ─── Seed: shipping_carriers';

let cachedSeedSql: string | null = null;

function loadSeedSql(): string {
  if (cachedSeedSql !== null) return cachedSeedSql;
  const full = readFileSync(MIGRATION_SQL_PATH, 'utf-8');
  const seedStart = full.indexOf(SEED_SECTION_MARKER);
  if (seedStart === -1) {
    throw new Error(
      `Could not find shipping seed section ("${SEED_SECTION_MARKER}") in ${MIGRATION_SQL_PATH}. ` +
        'If the migration was renamed or restructured, update MIGRATION_SQL_PATH / SEED_SECTION_MARKER here.',
    );
  }
  cachedSeedSql = full.substring(seedStart);
  return cachedSeedSql;
}

export async function ensureShippingReferenceData(): Promise<void> {
  const count = await prisma.shippingCarrier.count();
  if (count >= EXPECTED_CARRIER_COUNT) return;

  // The migration's seed section contains three statements (carriers,
  // desi tariffs via WITH+JOIN, Barem tariffs via WITH+JOIN). pg accepts
  // semicolon-separated multi-statement input through executeRawUnsafe;
  // statements run in order so the desi/Barem JOINs see the just-inserted
  // carrier rows.
  await prisma.$executeRawUnsafe(loadSeedSql());
}
