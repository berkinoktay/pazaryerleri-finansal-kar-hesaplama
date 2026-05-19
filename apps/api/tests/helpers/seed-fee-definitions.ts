/**
 * Ensures FeeDefinition reference data (4 Trendyol rows) exists in the
 * test database — mirrors `ensureShippingReferenceData` pattern.
 *
 * Why this exists: CI runs `prisma db push` to sync the schema, which does
 * NOT execute migration SQL — so the INSERTs in
 * `migrations/20260519175540_fee_definitions_trendyol_seed/migration.sql`
 * never run. Locally `prisma migrate dev` would apply them, but PR-1's
 * shadow DB issue forced manual `db push` + `prisma db execute`, so the
 * pattern is identical: read the migration's seed at test time, execute,
 * idempotent via ON CONFLICT DO NOTHING.
 *
 * `fee_definitions` IS in `truncateAll`'s wipe list — tests that need
 * the seed call this helper in `beforeEach` AFTER `truncateAll`, so each
 * test starts with a fresh 4-row reference set. Tests that don't depend
 * on the seed (e.g. PR-1's RLS isolation tests) don't call this and
 * operate on an empty table.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { prisma } from '@pazarsync/db';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MIGRATION_SQL_PATH = resolve(
  __dirname,
  '../../../../packages/db/prisma/migrations/20260519175540_fee_definitions_trendyol_seed/migration.sql',
);

const EXPECTED_TRENDYOL_ROWS = 4;
const SEED_SECTION_MARKER = '-- ─── Seed: fee_definitions';

let cachedSeedSql: string | null = null;

function loadSeedSql(): string {
  if (cachedSeedSql !== null) return cachedSeedSql;
  const full = readFileSync(MIGRATION_SQL_PATH, 'utf-8');
  const seedStart = full.indexOf(SEED_SECTION_MARKER);
  if (seedStart === -1) {
    throw new Error(
      `Could not find FeeDefinition seed section ("${SEED_SECTION_MARKER}") in ${MIGRATION_SQL_PATH}. ` +
        'If the migration was renamed or restructured, update MIGRATION_SQL_PATH / SEED_SECTION_MARKER here.',
    );
  }
  cachedSeedSql = full.substring(seedStart);
  return cachedSeedSql;
}

export async function ensureFeeDefinitions(): Promise<void> {
  const count = await prisma.feeDefinition.count({ where: { platform: 'TRENDYOL' } });
  if (count >= EXPECTED_TRENDYOL_ROWS) return;
  await prisma.$executeRawUnsafe(loadSeedSql());
}
