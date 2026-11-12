import { isPrismaKnownRequestError, mapPrismaError, syncLog } from '@pazarsync/sync-core';

import { IMPORT_BUSY_RETRY_AFTER_SECONDS } from '../config/workbook-limits';
import { ImportBusyError } from './errors';

/**
 * Prisma codes meaning the database could not give the transaction a slot in
 * time: P2028 (transaction API error, e.g. the transaction could not start
 * within `maxWait` or ran past `timeout`) and P2024 (timed out waiting for a
 * connection from the pool). Both are capacity problems, not bad input, so
 * they surface as a retryable 503 instead of a 500.
 */
const BUSY_PRISMA_CODES: ReadonlySet<string> = new Set(['P2028', 'P2024']);

/**
 * The finite numeric fields of a Prisma error's `meta` (e.g. P2028's `timeout`
 * and `timeTaken`). Strings are dropped on purpose so no message text reaches
 * the log. Takes `unknown` because the runtime value is not guaranteed to match
 * the declared type.
 */
function numericMetaFields(meta: unknown): Record<string, number> {
  const fields: Record<string, number> = {};
  if (typeof meta !== 'object' || meta === null) return fields;
  for (const [key, value] of Object.entries(meta)) {
    if (typeof value === 'number' && Number.isFinite(value)) fields[key] = value;
  }
  return fields;
}

/**
 * Catch-side mapper for import transactions. Transaction timeouts and pool
 * waits become `ImportBusyError` (503 + Retry-After) after a warning carrying
 * the Prisma code and the numeric timing hints, so a recurring timeout shows up
 * in the logs instead of hiding behind retryable 503s. Everything else goes
 * through `mapPrismaError`, which maps the known Prisma codes or rethrows the
 * original error untouched.
 *
 *   try { await prisma.$transaction(fn, IMPORT_TX_OPTIONS) } catch (err) { mapTransactionError(err); }
 */
export function mapTransactionError(err: unknown): never {
  if (isPrismaKnownRequestError(err) && BUSY_PRISMA_CODES.has(err.code)) {
    syncLog.warn('import.transaction-busy', {
      prismaCode: err.code,
      numericMeta: numericMetaFields(err.meta),
    });
    throw new ImportBusyError(IMPORT_BUSY_RETRY_AFTER_SECONDS);
  }
  mapPrismaError(err);
}

/**
 * Where Prisma 7 + `@prisma/adapter-pg` put the violated columns of a P2002.
 * There is no classic `meta.target`; the adapter's converted driver error sits
 * under `meta.driverAdapterError` and carries the columns on its `cause`.
 */
const UNIQUE_VIOLATION_FIELDS_PATH = [
  'meta',
  'driverAdapterError',
  'cause',
  'constraint',
  'fields',
] as const;

/** Walks `path` through nested objects; undefined as soon as a step is not an object. */
function readPath(value: unknown, path: readonly string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = Reflect.get(current, key);
  }
  return current;
}

/**
 * True when `err` is a unique-constraint violation (P2002) on `column`.
 *
 * Shape measured against Postgres with Prisma 7.8 + `@prisma/adapter-pg` 7.8 and
 * pinned by `tests/integration/services/tariff-week-unique-violation.test.ts`
 * (identical inside and outside an interactive transaction):
 *
 *   err.code === 'P2002'
 *   err.meta.modelName === 'CommissionTariff'
 *   err.meta.driverAdapterError.cause === {
 *     originalCode: '23505',
 *     originalMessage: 'duplicate key value violates unique constraint "<index name>"',
 *     kind: 'UniqueConstraintViolation',
 *     constraint: { fields: ['store_id', 'week_starts_at'] },
 *   }
 *
 * `fields` are database column names the adapter parses out of Postgres'
 * `Key (...)` detail, so `column` is the snake_case column, not the Prisma field
 * name. When Postgres sends no detail the adapter omits `constraint` and this
 * returns false, leaving the caller on its generic mapping.
 */
export function isUniqueViolationOn(err: unknown, column: string): boolean {
  if (!isPrismaKnownRequestError(err) || err.code !== 'P2002') return false;
  const fields = readPath(err, UNIQUE_VIOLATION_FIELDS_PATH);
  return Array.isArray(fields) && fields.some((field) => field === column);
}
