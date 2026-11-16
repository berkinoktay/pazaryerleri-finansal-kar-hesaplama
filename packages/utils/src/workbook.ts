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

const BYTES_PER_MB = 1024 * 1024;

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
 * truncation read it, and the web name inputs use it as their `maxLength` and in the
 * "name too long" message.
 */
export const UPLOAD_NAME_MAX_LENGTH = 120;
