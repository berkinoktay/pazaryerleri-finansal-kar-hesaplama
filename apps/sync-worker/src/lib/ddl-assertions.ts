// Boot-time DDL guard for the sync worker.
//
// Two classes of correctness-critical schema live ONLY in the hand-applied SQL
// under supabase/sql -- they are NOT mirrored into Prisma migrations, so a
// database recreated by `prisma migrate dev` / `supabase db reset` comes up
// structurally valid to Prisma but silently missing them:
//
//   1. Partial indexes (Prisma 7 has no native WHERE-clause syntax):
//        - one-active-job-per-(store, sync_type) UNIQUE: duplicate sync jobs run
//          in parallel and double-write orders/fees;
//        - fee idempotency UNIQUE: a racing settlement re-poll or a late cost
//          re-entry double-books a fee row and corrupts the write-once profit
//          numbers;
//        - webhook ingest-queue scan (non-unique): the consumer tick scans the
//          small unprocessed tail of webhook_events; without it the queue scan
//          degrades to a full walk of the ever-growing audit log.
//   2. supabase_realtime publication membership: the frontend's live surfaces
//        subscribe to sync_logs UPDATE, orders INSERT, and
//        live_performance_buffer '*' (INSERT + UPDATE) events. When a table is
//        recreated without being re-added to the publication, REST still works
//        and the channel still reaches SUBSCRIBED, but ZERO events arrive --
//        indistinguishable from genuinely frozen sync progress.
//
// Both are created by `pnpm db:push` (which chains the apply-policies step) in
// dev, and by the apply-policies deploy step in prod. Both failures are SILENT
// (wrong numbers / dead live surfaces, no error). This module turns that silent
// risk into a loud, fail-fast boot error.

import type { PrismaClient } from '@pazarsync/db';

// The correctness-critical partial indexes that live only in supabase/sql
// (NOT in Prisma migrations). Keep this list in sync with its two canonical
// source files:
//   supabase/sql/rls-policies.sql      -> sync_logs_active_slot_uniq
//   supabase/sql/check-constraints.sql -> order_fees_estimate_fee_type_uniq,
//                                         org_period_fees_settlement_row_uniq,
//                                         webhook_events_unprocessed_idx
// The first three are UNIQUE guards; webhook_events_unprocessed_idx is a
// non-unique queue-scan index registered here so a db reset that skips
// supabase/sql can't silently drop the webhook ingest queue's scan support.
export const REQUIRED_INDEXES = [
  'sync_logs_active_slot_uniq',
  'order_fees_estimate_fee_type_uniq',
  'org_period_fees_settlement_row_uniq',
  'webhook_events_unprocessed_idx',
] as const;

// The tables that MUST be members of the supabase_realtime publication for the
// frontend's live surfaces to receive events. Canonical source (the ALTER
// PUBLICATION ADD TABLE statements): supabase/sql/realtime-publications.sql.
//   - sync_logs               -> SyncCenter subscribes to UPDATE
//   - orders                  -> Live Performance subscribes to INSERT
//   - live_performance_buffer -> Live Performance subscribes to '*' (INSERT + UPDATE)
export const REQUIRED_PUBLICATION_TABLES = [
  'sync_logs',
  'orders',
  'live_performance_buffer',
] as const;

// The publication operations the frontend actually depends on. The three
// required tables together need INSERT (orders, buffer) and UPDATE (sync_logs,
// buffer), so both must be published. These are boolean columns on
// pg_publication; Supabase creates supabase_realtime with the Postgres default
// (publish = 'insert, update, delete, truncate'), so a healthy publication has
// them true -- a DB where they were turned off publishes no INSERT/UPDATE.
export const REQUIRED_PUBLICATION_FLAGS = ['pubinsert', 'pubupdate'] as const;

// The Supabase-managed realtime publication. Created by `supabase start` (and by
// setup-test-db.ts for the isolated test DB); its table membership is populated
// by supabase/sql/realtime-publications.sql via the apply-policies step.
const REALTIME_PUBLICATION = 'supabase_realtime';

const REMEDIATION =
  'run `pnpm db:push` (dev) or the apply-policies deploy step -- ' +
  'supabase/sql was not applied to this database';

/** The three categories of correctness-critical DDL this guard verifies. */
interface MissingDdl {
  readonly indexes: readonly string[];
  readonly publicationTables: readonly string[];
  readonly publicationFlags: readonly string[];
}

function buildMessage(missing: MissingDdl): string {
  const parts: string[] = [];
  if (missing.indexes.length > 0) {
    parts.push(
      `missing partial index(es): ${missing.indexes.join(', ')} ` +
        `(without them the worker silently loses duplicate-job protection, ` +
        `fee idempotency -> wrong profit numbers, or webhook ingest-queue scan ` +
        `support, no error)`,
    );
  }
  if (missing.publicationTables.length > 0) {
    parts.push(
      `missing supabase_realtime publication table(s): ${missing.publicationTables.join(', ')} ` +
        `(the frontend's live surfaces subscribe but receive zero events)`,
    );
  }
  if (missing.publicationFlags.length > 0) {
    parts.push(
      `supabase_realtime is not publishing required operation(s): ${missing.publicationFlags.join(', ')} ` +
        `(realtime INSERT/UPDATE events never fire for any table)`,
    );
  }
  return (
    `Database is missing correctness-critical DDL from supabase/sql -- ${parts.join('; ')}. ` +
    `Remediation: ${REMEDIATION}.`
  );
}

/**
 * Thrown when the connected database is missing one or more pieces of
 * correctness-critical DDL. Carries each category separately so the boot log
 * (and tests) can assert on the exact absent names:
 *   - `missing`                   -> partial unique index names
 *   - `missingPublicationTables`  -> supabase_realtime table members
 *   - `missingPublicationFlags`   -> publication operation flags (pubinsert/pubupdate)
 */
export class MissingCriticalDdlError extends Error {
  readonly missing: readonly string[];
  readonly missingPublicationTables: readonly string[];
  readonly missingPublicationFlags: readonly string[];

  constructor(missing: MissingDdl) {
    super(buildMessage(missing));
    this.name = 'MissingCriticalDdlError';
    this.missing = missing.indexes;
    this.missingPublicationTables = missing.publicationTables;
    this.missingPublicationFlags = missing.publicationFlags;
  }
}

/**
 * Return the subset of `expected` index names that do NOT exist in the public
 * schema. ONE parameterized pg_indexes lookup (`= ANY($1::text[])`), then
 * subtract present from expected. Non-throwing so the combined boot check can
 * aggregate every category into a single error.
 */
async function findMissingIndexes(
  client: PrismaClient,
  expected: readonly string[],
): Promise<string[]> {
  const names: string[] = [...expected];
  const rows = await client.$queryRaw<Array<{ indexname: string }>>`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = ANY(${names}::text[])
  `;
  const present = new Set(rows.map((row) => row.indexname));
  return expected.filter((name) => !present.has(name));
}

/**
 * Return the subset of `expected` table names that are NOT members of the
 * supabase_realtime publication in the public schema. ONE parameterized
 * pg_publication_tables lookup (`= ANY($1::text[])`), then subtract present
 * from expected. Non-throwing (mirrors findMissingIndexes).
 */
async function findMissingPublicationTables(
  client: PrismaClient,
  expected: readonly string[],
): Promise<string[]> {
  const names: string[] = [...expected];
  const rows = await client.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename
    FROM pg_publication_tables
    WHERE pubname = ${REALTIME_PUBLICATION}
      AND schemaname = 'public'
      AND tablename = ANY(${names}::text[])
  `;
  const present = new Set(rows.map((row) => row.tablename));
  return expected.filter((name) => !present.has(name));
}

/**
 * The pg_publication flag row this checker reads. Named so the narrow client
 * surface below can reference it and a unit test can build a fake row with no DB.
 */
interface PublicationFlagRow {
  pubinsert: boolean;
  pubupdate: boolean;
  pubdelete: boolean;
  pubtruncate: boolean;
}

/**
 * The minimal client surface findMissingPublicationFlags depends on: one raw
 * query that yields the pg_publication flag row. PrismaClient satisfies this
 * structurally (its generic `$queryRaw` instantiates to this shape), so
 * assertCriticalDdl still passes the real client; a unit test can pass a
 * hand-built fake `$queryRaw` (no DB) without a type assertion.
 */
interface PublicationFlagQueryClient {
  $queryRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<PublicationFlagRow[]>;
}

/**
 * Return the subset of `required` publication operation flags that the
 * supabase_realtime publication is NOT publishing. Reads the boolean flag
 * columns from pg_publication; if the publication itself is absent, every
 * required flag counts as missing. Exported so both negative branches (absent
 * publication row, a flag published false) are unit-testable with a fake client
 * -- never mutate the real publication to prove the failure.
 */
export async function findMissingPublicationFlags(
  client: PublicationFlagQueryClient,
  required: readonly string[],
): Promise<string[]> {
  const rows = await client.$queryRaw`
    SELECT pubinsert, pubupdate, pubdelete, pubtruncate
    FROM pg_publication
    WHERE pubname = ${REALTIME_PUBLICATION}
  `;
  const row = rows[0];
  if (row === undefined) {
    return [...required];
  }
  const published: Record<string, boolean> = {
    pubinsert: row.pubinsert,
    pubupdate: row.pubupdate,
    pubdelete: row.pubdelete,
    pubtruncate: row.pubtruncate,
  };
  return required.filter((flag) => published[flag] !== true);
}

/**
 * Checker parameterized by the expected index list: throws
 * MissingCriticalDdlError naming every absent index, resolves when all present.
 * Exported so the negative path is testable with a fabricated name -- never drop
 * a real index from the shared schema to prove the failure.
 */
export async function assertIndexesExist(
  client: PrismaClient,
  expected: readonly string[],
): Promise<void> {
  const missing = await findMissingIndexes(client, expected);
  if (missing.length > 0) {
    throw new MissingCriticalDdlError({
      indexes: missing,
      publicationTables: [],
      publicationFlags: [],
    });
  }
}

/**
 * Checker parameterized by the expected publication-table list: throws
 * MissingCriticalDdlError naming every table absent from supabase_realtime,
 * resolves when all present. Exported so the negative path is testable with a
 * fabricated name -- never mutate the real publication to prove the failure.
 */
export async function assertPublicationTablesExist(
  client: PrismaClient,
  expected: readonly string[],
): Promise<void> {
  const missing = await findMissingPublicationTables(client, expected);
  if (missing.length > 0) {
    throw new MissingCriticalDdlError({
      indexes: [],
      publicationTables: missing,
      publicationFlags: [],
    });
  }
}

/**
 * Assert that the connected database carries every piece of correctness-critical
 * DDL from supabase/sql: the partial unique indexes (REQUIRED_INDEXES), the
 * supabase_realtime table members (REQUIRED_PUBLICATION_TABLES), and the
 * publication operation flags (REQUIRED_PUBLICATION_FLAGS). Runs all three
 * checks, then throws ONE MissingCriticalDdlError whose message separates the
 * missing indexes from the missing publication tables / flags -- so a single
 * boot log line names everything the operator must fix.
 *
 * Called once at worker boot; the boot block turns the throw into a fatal log +
 * non-zero exit (same fail-fast contract as env validation).
 */
export async function assertCriticalDdl(client: PrismaClient): Promise<void> {
  const [indexes, publicationTables, publicationFlags] = await Promise.all([
    findMissingIndexes(client, REQUIRED_INDEXES),
    findMissingPublicationTables(client, REQUIRED_PUBLICATION_TABLES),
    findMissingPublicationFlags(client, REQUIRED_PUBLICATION_FLAGS),
  ]);
  if (indexes.length > 0 || publicationTables.length > 0 || publicationFlags.length > 0) {
    throw new MissingCriticalDdlError({ indexes, publicationTables, publicationFlags });
  }
}
