// The guards an import takes inside its transaction, before it writes anything, in
// this order: one import per store and page at a time (a transaction-level advisory
// TRY-lock that refuses), then the store's quota lock (a blocking transaction-level
// advisory lock over the whole store, so imports to different pages of one store check
// the byte quota one after the other), then the store's upload quota: a list limit per
// page (the lists of this page in this store), and a byte limit per store (the stored
// source bytes over every workbook page, the incoming file included). The import also
// runs the quota once before the file is parsed, outside both locks, so a full store is
// refused before the costly work; the check inside the transaction stays the authority.
// No SQL here takes an identifier from a variable: the six table names are written out
// in one static query, and the lock queries bind only their key and seed.

import { Prisma } from '@pazarsync/db';
import { syncLog } from '@pazarsync/sync-core';
import { UPLOAD_QUOTA_LIMITS, type WorkbookPage } from '@pazarsync/utils';

import {
  IMPORT_BUSY_RETRY_AFTER_SECONDS,
  MAX_LISTS_PER_STORE_PAGE,
  STORE_QUOTA_LOCK_TIMEOUT_MS,
  STORE_UPLOAD_QUOTA_BYTES,
} from '../config/workbook-limits';
import { ImportBusyError, WorkbookConflictError } from '../lib/errors';
import { postgresSqlState } from '../lib/postgres-sql-state';
import type { StoreScope } from './adapter';

/** The parent tables that store an uploaded source file (the list `rls-policies.sql` holds). */
export const WORKBOOK_PARENT_TABLES = [
  'commission_tariffs',
  'plus_commission_tariffs',
  'advantage_tariffs',
  'flash_product_lists',
  'discount_lists',
  'marketplace_campaign_lists',
] as const;

export type WorkbookParentTable = (typeof WORKBOOK_PARENT_TABLES)[number];

export interface UploadLimits {
  readonly maxLists: number;
  readonly maxBytes: number;
}

export const DEFAULT_UPLOAD_LIMITS: UploadLimits = {
  maxLists: MAX_LISTS_PER_STORE_PAGE,
  maxBytes: STORE_UPLOAD_QUOTA_BYTES,
};

/**
 * Seed of the import lock's `hashtextextended`. Non-zero, so its key space never meets
 * the profit recompute lock, which hashes with seed 0.
 */
export const WORKBOOK_IMPORT_LOCK_SEED = 4_202_611;

/** The import lock key of one store and page; the store id is the stored, lower-case one. */
export function importLockKey(scope: StoreScope, page: WorkbookPage): string {
  return `${scope.storeId}:${page}`;
}

function isLockRow(value: unknown): value is { locked: boolean } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'locked' in value &&
    typeof value.locked === 'boolean'
  );
}

/**
 * Takes the transaction-level advisory lock of this store and page without waiting;
 * Postgres releases it when the transaction ends. Throws
 * `WorkbookConflictError('IMPORT_IN_PROGRESS')` when another transaction holds it.
 */
export async function acquireImportLock(
  tx: Prisma.TransactionClient,
  scope: StoreScope,
  page: WorkbookPage,
): Promise<void> {
  const key = importLockKey(scope, page);
  const query = Prisma.sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, ${WORKBOOK_IMPORT_LOCK_SEED}::int8)) AS "locked"`;
  const rows = await tx.$queryRaw<unknown[]>(query);
  const row = rows[0];
  if (!isLockRow(row) || !row.locked) throw new WorkbookConflictError('IMPORT_IN_PROGRESS');
}

/**
 * Seed of the store quota lock's `hashtextextended`. A different seed is a different
 * hash function, so its key space never meets the import lock's
 * (`WORKBOOK_IMPORT_LOCK_SEED`) or the profit recompute lock's, which hashes with seed 0.
 */
export const WORKBOOK_QUOTA_LOCK_SEED = 4_202_612;

/** The quota lock key of one store: the stored, lower-case store id. */
export function quotaLockKey(scope: StoreScope): string {
  return scope.storeId;
}

/** Postgres' SQLSTATE for a lock wait that passed `lock_timeout` (lock_not_available). */
const LOCK_NOT_AVAILABLE_SQLSTATE = '55P03';

/**
 * Takes the transaction-level advisory lock of the whole store and WAITS for it;
 * Postgres releases it when the transaction ends. Blocking on purpose: under READ
 * COMMITTED the next statement takes a fresh snapshot, so the byte sum that follows
 * (`assertUploadQuota`) sees a peer import that committed while this one waited, and
 * imports to different pages of one store cannot overshoot the byte quota together.
 *
 * No deadlock: the only lock an import takes before this one is the page TRY-lock
 * (`acquireImportLock`), which never waits. A waiter holds one pooled connection, and
 * at most one import per page per store can wait (the page lock comes first), so at
 * most six per store.
 *
 * The wait is bounded on the server: `lock_timeout` is `lockTimeoutMs` for the lock
 * statement only (`set_config(..., true)`, local to the transaction), then back to its
 * default, so the writes that follow keep their own lock waits. Prisma's transaction
 * timeout could not bound it: it cancels no statement already running, so a waiter
 * would hold its connection until the holder ended. A wait past the bound answers the
 * existing retryable 503 `IMPORT_BUSY`; no new wire code exists.
 *
 * `$executeRaw`, not `$queryRaw`: pg_advisory_xact_lock and set_config return values
 * the caller has no use for.
 */
export async function acquireStoreQuotaLock(
  tx: Prisma.TransactionClient,
  scope: StoreScope,
  lockTimeoutMs: number = STORE_QUOTA_LOCK_TIMEOUT_MS,
): Promise<void> {
  const key = quotaLockKey(scope);
  // A unitless lock_timeout is milliseconds.
  await tx.$executeRaw(
    Prisma.sql`SELECT set_config('lock_timeout', ${String(lockTimeoutMs)}, true)`,
  );
  try {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, ${WORKBOOK_QUOTA_LOCK_SEED}::int8))`,
    );
  } catch (err) {
    if (postgresSqlState(err) !== LOCK_NOT_AVAILABLE_SQLSTATE) throw err;
    syncLog.warn('workbook.import.store-lock-timeout', { lockTimeoutMs });
    throw new ImportBusyError(IMPORT_BUSY_RETRY_AFTER_SECONDS);
  }
  await tx.$executeRaw(Prisma.sql`SET LOCAL lock_timeout TO DEFAULT`);
}

/**
 * The one query that sums the stored source bytes of a store over the six parent tables.
 * Static text: every table name is written out, only the two ids are bound.
 */
export function storedUploadBytesSql(scope: StoreScope): Prisma.Sql {
  const { organizationId, storeId } = scope;
  return Prisma.sql`
    SELECT COALESCE(SUM("bytes"), 0)::text AS "bytes" FROM (
      SELECT COALESCE(SUM(octet_length("source_file")), 0) AS "bytes" FROM "commission_tariffs"
        WHERE "organization_id" = ${organizationId}::uuid AND "store_id" = ${storeId}::uuid
      UNION ALL
      SELECT COALESCE(SUM(octet_length("source_file")), 0) AS "bytes" FROM "plus_commission_tariffs"
        WHERE "organization_id" = ${organizationId}::uuid AND "store_id" = ${storeId}::uuid
      UNION ALL
      SELECT COALESCE(SUM(octet_length("source_file")), 0) AS "bytes" FROM "advantage_tariffs"
        WHERE "organization_id" = ${organizationId}::uuid AND "store_id" = ${storeId}::uuid
      UNION ALL
      SELECT COALESCE(SUM(octet_length("source_file")), 0) AS "bytes" FROM "flash_product_lists"
        WHERE "organization_id" = ${organizationId}::uuid AND "store_id" = ${storeId}::uuid
      UNION ALL
      SELECT COALESCE(SUM(octet_length("source_file")), 0) AS "bytes" FROM "discount_lists"
        WHERE "organization_id" = ${organizationId}::uuid AND "store_id" = ${storeId}::uuid
      UNION ALL
      SELECT COALESCE(SUM(octet_length("source_file")), 0) AS "bytes" FROM "marketplace_campaign_lists"
        WHERE "organization_id" = ${organizationId}::uuid AND "store_id" = ${storeId}::uuid
    ) AS "stored"`;
}

const DIGITS_RE = /^\d+$/;

function isBytesRow(value: unknown): value is { bytes: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'bytes' in value &&
    typeof value.bytes === 'string' &&
    DIGITS_RE.test(value.bytes)
  );
}

/** The bytes of every source file the store holds, over all six workbook pages. */
export async function storedUploadBytes(
  tx: Prisma.TransactionClient,
  scope: StoreScope,
): Promise<number> {
  const rows = await tx.$queryRaw<unknown[]>(storedUploadBytesSql(scope));
  const row = rows[0];
  if (!isBytesRow(row)) throw new Error('Stored upload bytes query returned no byte count');
  return Number(row.bytes);
}

/**
 * Throws `WorkbookConflictError('UPLOAD_QUOTA_EXCEEDED')` unless the page holds fewer
 * than `limits.maxLists` lists in this store (a per-page limit) and the store's stored
 * bytes over every workbook page plus the incoming file stay within `limits.maxBytes`
 * (a store-wide limit): the file that would cross the limit is the one refused. The
 * error's meta names the limit that was hit and its maximum: `{ limit: 'lists',
 * maxLists }` or `{ limit: 'bytes', maxBytes }`.
 */
export async function assertUploadQuota(
  tx: Prisma.TransactionClient,
  scope: StoreScope,
  input: { readonly listCount: number; readonly incomingBytes: number },
  limits: UploadLimits = DEFAULT_UPLOAD_LIMITS,
): Promise<void> {
  if (input.listCount >= limits.maxLists) {
    throw new WorkbookConflictError('UPLOAD_QUOTA_EXCEEDED', {
      limit: UPLOAD_QUOTA_LIMITS.LISTS,
      maxLists: limits.maxLists,
    });
  }
  const storedBytes = await storedUploadBytes(tx, scope);
  if (storedBytes + input.incomingBytes > limits.maxBytes) {
    throw new WorkbookConflictError('UPLOAD_QUOTA_EXCEEDED', {
      limit: UPLOAD_QUOTA_LIMITS.BYTES,
      maxBytes: limits.maxBytes,
    });
  }
}
