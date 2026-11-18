/**
 * Largest workbook file (bytes) a seller may upload to a campaign import.
 *
 * One number, read in three places so they can never disagree: the web upload
 * dialogs use it as the client-side size hint, the API derives its HTTP body
 * limit from it (plus the multipart envelope), and the spreadsheet engine's
 * size gate enforces the same value (`DEFAULT_MAX_BYTES` in
 * `@pazarsync/spreadsheet`, pinned equal by an API unit test).
 */
export const WORKBOOK_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

export const BYTES_PER_MB = 1024 * 1024;

/**
 * The same limit in whole megabytes, for the upload dialogs' hint text. Derived
 * from WORKBOOK_UPLOAD_MAX_BYTES so the shown number and the enforced limit
 * cannot drift apart.
 */
export const WORKBOOK_UPLOAD_MAX_MB = WORKBOOK_UPLOAD_MAX_BYTES / BYTES_PER_MB;

/**
 * Longest stored list name and stored upload file name, in code points.
 *
 * One number for both sides: the API's name rule (`NameSchema`) and its stored-name
 * truncation read it, and the web name inputs check it (in code points, as the API counts)
 * and show it in the "name too long" message.
 */
export const UPLOAD_NAME_MAX_LENGTH = 120;

// The UTC years a stored instant may have. A year below 1 reaches Postgres in a form it
// refuses (measured with Prisma 7 and @prisma/adapter-pg: 22007, and 22009 near the
// earliest JavaScript date), a 500 at the insert; a year such as 50 or 10000 would be
// stored as read, and no real campaign window lies outside these years either. One pair
// for both sides: the API's date rules read it, and the web names the two years in its
// "date out of range" message.
export const STORABLE_YEAR_MIN = 1900;
export const STORABLE_YEAR_MAX = 9999;
