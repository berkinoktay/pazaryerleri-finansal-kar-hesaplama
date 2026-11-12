/**
 * Workbook upload and import limits. Single source of truth for the numbers
 * the upload guard and the import services apply, so the policy reads in one
 * place instead of as magic numbers inside middleware and service calls.
 * Every value here is API-only.
 */

/**
 * Headroom added on top of the file size limit when capping the raw request
 * body. A multipart upload carries boundaries, part headers and the other form
 * fields around the file bytes, so the body limit is the file limit plus this
 * envelope. 64 KiB is far more than the envelope ever needs while still
 * negligible next to the file limit.
 */
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/**
 * Interactive transaction options for every workbook import.
 *
 * - `maxWait`: how long an import may wait to acquire a connection and start
 *   its transaction. Kept short so a saturated pool fails fast with
 *   IMPORT_BUSY instead of stacking requests behind it.
 * - `timeout`: how long the transaction may run once started. Large enough for
 *   a maximum-size file's row writes, bounded so a stuck import cannot hold a
 *   connection indefinitely.
 *
 * Values are milliseconds, as Prisma's `$transaction` options expect.
 */
export const IMPORT_TX_OPTIONS = { maxWait: 5_000, timeout: 30_000 } as const;

/**
 * `Retry-After` value (seconds) sent with 503 IMPORT_BUSY. Matches the order
 * of magnitude of `IMPORT_TX_OPTIONS.maxWait`: by then a pool slot has
 * usually freed up.
 */
export const IMPORT_BUSY_RETRY_AFTER_SECONDS = 5;
