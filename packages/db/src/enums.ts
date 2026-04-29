// Server-safe enum re-exports + helper guards. This entry point intentionally
// does NOT import or initialize the Prisma client — `@pazarsync/db` (root entry)
// constructs a PrismaClient at module load and reads DATABASE_URL, which would
// crash a browser bundle. Apps that only need enum values, types, or guards
// (e.g. apps/web for Zod schema parity) import from `@pazarsync/db/enums`
// to stay free of that side effect.

export * from '../generated/prisma/enums';

import { SyncErrorCode } from '../generated/prisma/enums';

const SYNC_ERROR_CODE_VALUES: ReadonlySet<string> = new Set(Object.values(SyncErrorCode));

/**
 * Type guard: narrows `unknown` to `SyncErrorCode` if the value is a known
 * enum member. Used by the sync worker to gate writes to `sync_log.error_code`,
 * by the API validator to round-trip JSONB shapes, and by the frontend to
 * format error copy. Single source of truth — extending `SyncErrorCode` in
 * `schema.prisma` automatically updates the validation set after `db:generate`.
 */
export function isSyncErrorCode(value: unknown): value is SyncErrorCode {
  return typeof value === 'string' && SYNC_ERROR_CODE_VALUES.has(value);
}
