import { MAX_ERROR_CAUSE_LENGTH } from '../constants';
import { SpreadsheetFileError } from '../errors';
import { ZIP_REJECT_REASONS } from './reasons';

// Small helpers several files of the export patch path share. The byte constants of
// the markup grammar live in xml-lexer.ts.

// Message prefix of every request-validation error: a caller bug, not a file error.
const INVALID_PATCH_REQUEST = 'Invalid patch request: ';

/** A plain Error whose message is INVALID_PATCH_REQUEST followed by `detail`. */
export function invalidPatchRequest(detail: string): Error {
  return new Error(`${INVALID_PATCH_REQUEST}${detail}`);
}

/** An entry name cut to MAX_ERROR_CAUSE_LENGTH characters for error meta: a zip name can be 64 KB long. */
export function metaEntryName(name: string): string {
  return name.slice(0, MAX_ERROR_CAUSE_LENGTH);
}

/**
 * Whether `length` bytes of `a` from `aStart` equal `length` bytes of `b` from
 * `bStart`; false when either range runs outside its array. `a` and `b` may be the
 * same array. One pass, nothing allocated.
 */
export function bytesEqualAt(
  a: Uint8Array,
  aStart: number,
  b: Uint8Array,
  bStart: number,
  length: number,
): boolean {
  if (aStart < 0 || bStart < 0 || aStart + length > a.length || bStart + length > b.length) {
    return false;
  }
  for (let offset = 0; offset < length; offset += 1) {
    if (a[aStart + offset] !== b[bStart + offset]) return false;
  }
  return true;
}

/** CORRUPT_FILE `{ reason: 'zip-view-mismatch', entry }`: the directory's entry is not the part the gate read. */
export function viewMismatch(entryName: string, message: string): SpreadsheetFileError {
  return new SpreadsheetFileError('CORRUPT_FILE', message, {
    reason: ZIP_REJECT_REASONS.VIEW_MISMATCH,
    entry: metaEntryName(entryName),
  });
}

/** What turns the code unit of an upper-case ASCII letter into its lower case. */
const ASCII_CASE_OFFSET = 0x20;
// The upper-case ASCII letters and nothing else.
const ASCII_UPPER_CASE_LETTER = /[A-Z]/g;

/**
 * `text` with A-Z turned into a-z and every other code unit kept: the ASCII case
 * folding OPC compares part names under, and XML an encoding name. Never
 * toLowerCase, which also folds letters outside ASCII (U+212A KELVIN SIGN becomes 'k').
 */
export function foldAsciiCase(text: string): string {
  return text.replace(ASCII_UPPER_CASE_LETTER, (letter) =>
    String.fromCharCode(letter.charCodeAt(0) + ASCII_CASE_OFFSET),
  );
}
