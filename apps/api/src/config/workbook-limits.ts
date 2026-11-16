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

/**
 * How many headers of another format's fingerprint a header row must carry before
 * an upload on the wrong page names that format (`diagnoseWorkbook`).
 */
export const FINGERPRINT_MIN_HEADERS = 3;

/** Lists one store may hold on one workbook page; the next import is refused. */
export const MAX_LISTS_PER_STORE_PAGE = 50;

/**
 * Bytes of stored source files one store may hold across every workbook page, the
 * incoming file included: 200 MiB.
 */
export const STORE_UPLOAD_QUOTA_BYTES = 200 * 1024 * 1024;

/** Item rows one `createMany` call of an import writes. */
export const IMPORT_INSERT_CHUNK_ROWS = 1000;

/** Longest stored workbook format id (`source_format_id` column width). */
export const SOURCE_FORMAT_ID_MAX_LENGTH = 64;

/**
 * Longest anchor text (the barcode cell) an import accepts. A longer anchor is a
 * malformed sheet: it keeps every patch request well under the engine's text budget.
 */
export const MAX_ANCHOR_TEXT_LENGTH = 256;

/**
 * Integer digits of the widest number an export may write, and of the probe the
 * import rehearsal writes. Covers the `@db.Decimal(12, 2)` price columns of the six
 * workbook item tables (10 integer digits).
 */
export const PROBE_INTEGER_DIGITS = 10;
