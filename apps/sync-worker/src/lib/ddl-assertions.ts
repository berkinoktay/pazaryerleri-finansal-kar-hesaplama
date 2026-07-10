// Boot-time DDL guard for the sync worker.
//
// A handful of correctness-critical partial UNIQUE indexes exist ONLY in the
// hand-applied SQL under supabase/sql -- they are NOT mirrored into Prisma
// migrations, because Prisma 7 has no native syntax for WHERE-clause (partial)
// unique indexes. They are created by `pnpm db:push` (which chains the
// apply-policies step) in dev, and by the apply-policies deploy step in prod.
//
// A database bootstrapped WITHOUT that step comes up structurally valid to
// Prisma but silently missing:
//   - one-active-job-per-(store, sync_type): duplicate sync jobs run in
//     parallel and double-write orders/fees;
//   - fee idempotency: a racing settlement re-poll or a late cost re-entry
//     double-books a fee row and corrupts the write-once profit numbers.
// Both failures are SILENT (wrong numbers, no error). This module turns that
// silent data-corruption risk into a loud, fail-fast boot error.

import type { PrismaClient } from '@pazarsync/db';

// The correctness-critical partial UNIQUE indexes that live only in supabase/sql
// (NOT in Prisma migrations). Keep this list in sync with its two canonical
// source files:
//   supabase/sql/rls-policies.sql      -> sync_logs_active_slot_uniq
//   supabase/sql/check-constraints.sql -> order_fees_estimate_fee_type_uniq,
//                                         org_period_fees_settlement_row_uniq
export const REQUIRED_INDEXES = [
  'sync_logs_active_slot_uniq',
  'order_fees_estimate_fee_type_uniq',
  'org_period_fees_settlement_row_uniq',
] as const;

const REMEDIATION =
  'run `pnpm db:push` (dev) or the apply-policies deploy step -- ' +
  'supabase/sql was not applied to this database';

/**
 * Thrown when the connected database is missing one or more of the
 * correctness-critical partial unique indexes. Carries the exact missing
 * names so the boot log (and tests) can assert on them.
 */
export class MissingCriticalDdlError extends Error {
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    super(
      `Database is missing correctness-critical partial unique index(es): ` +
        `${missing.join(', ')}. Without them the worker silently loses ` +
        `duplicate-job protection and/or fee idempotency (wrong profit numbers, ` +
        `no error). Remediation: ${REMEDIATION}.`,
    );
    this.name = 'MissingCriticalDdlError';
    this.missing = missing;
  }
}

/**
 * Checker parameterized by the expected index list. Runs ONE parameterized
 * pg_indexes lookup (public schema, `= ANY($1::text[])`), computes the missing
 * set, and throws MissingCriticalDdlError naming every absent index. Exported
 * so the negative path is testable with a fabricated name -- never drop a real
 * index from the shared schema to prove the failure.
 */
export async function assertIndexesExist(
  client: PrismaClient,
  expected: readonly string[],
): Promise<void> {
  const names: string[] = [...expected];
  const rows = await client.$queryRaw<Array<{ indexname: string }>>`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = ANY(${names}::text[])
  `;
  const present = new Set(rows.map((row) => row.indexname));
  const missing = expected.filter((name) => !present.has(name));
  if (missing.length > 0) {
    throw new MissingCriticalDdlError(missing);
  }
}

/**
 * Assert that every correctness-critical partial unique index (REQUIRED_INDEXES)
 * exists in the connected database. Called once at worker boot; on any missing
 * index it throws MissingCriticalDdlError, which the boot block turns into a
 * fatal log + non-zero exit (same fail-fast contract as env validation).
 */
export async function assertCriticalDdl(client: PrismaClient): Promise<void> {
  await assertIndexesExist(client, REQUIRED_INDEXES);
}
