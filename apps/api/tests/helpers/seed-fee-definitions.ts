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

// Every migration whose file embeds a FeeDefinition seed section. New fee
// rows ship inside their own migration (PR-2 pattern) — append the path here
// and bump EXPECTED_FEE_DEFINITION_ROWS so tests pick the row up.
// Order matters: the denetim-A migration's seed section runs AFTER the PR-2 seed
// (it DELETEs the PR-2 TRENDYOL STOPPAGE and replaces it with the 'ALL' row).
const SEED_MIGRATION_PATHS = [
  '../../../../packages/db/prisma/migrations/20260519175540_fee_definitions_trendyol_seed/migration.sql',
  '../../../../packages/db/prisma/migrations/20260610090000_cargo_invoice_foundation/migration.sql',
  '../../../../packages/db/prisma/migrations/20260614020000_fee_scope_commission_vat/migration.sql',
].map((rel) => resolve(__dirname, rel));

// PR-2: PSF + PSF_FAST + RETURN_SHIPPING (TRENDYOL) + STOPPAGE (ALL, denetim A) ·
// PR-8: SHIPPING (TRENDYOL) · denetim A: COMMISSION_INVOICE (ALL). 6 total: 4
// TRENDYOL + 2 ALL. Count is over ALL rows (not just TRENDYOL) since the
// fee scope is now mixed (FeeScope enum).
const EXPECTED_FEE_DEFINITION_ROWS = 6;
const SEED_SECTION_MARKER = '-- ─── Seed: fee_definitions';

let cachedSeedSqls: string[] | null = null;

function loadSeedSqls(): string[] {
  if (cachedSeedSqls !== null) return cachedSeedSqls;
  cachedSeedSqls = SEED_MIGRATION_PATHS.map((path) => {
    const full = readFileSync(path, 'utf-8');
    const seedStart = full.indexOf(SEED_SECTION_MARKER);
    if (seedStart === -1) {
      throw new Error(
        `Could not find FeeDefinition seed section ("${SEED_SECTION_MARKER}") in ${path}. ` +
          'If the migration was renamed or restructured, update SEED_MIGRATION_PATHS / SEED_SECTION_MARKER here.',
      );
    }
    return full.substring(seedStart);
  });
  return cachedSeedSqls;
}

export async function ensureFeeDefinitions(): Promise<void> {
  const count = await prisma.feeDefinition.count();
  if (count >= EXPECTED_FEE_DEFINITION_ROWS) return;
  for (const sql of loadSeedSqls()) {
    await prisma.$executeRawUnsafe(sql);
  }
}
