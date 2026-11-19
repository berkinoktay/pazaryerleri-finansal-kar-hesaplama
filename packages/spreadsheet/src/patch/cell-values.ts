import { MAX_PATCH_NUMBER_LENGTH, MAX_PATCH_TEXT_LENGTH } from '../constants';
import type { CellPatchValue } from './patch-request';
import { invalidPatchRequest } from './shared';

// A number cell's `<v>` must be a plain decimal: optional minus, no leading zeros,
// optional fraction, no exponent, no grouping or comma separator. Anything else
// (`1e-7`, `NaN`, `12,50`) would be written verbatim and read back wrong or not at all.
const PLAIN_DECIMAL_RE = /^-?(0|[1-9]\d*)(\.\d+)?$/;
const DECIMAL_POINT = '.';

const TAB = 0x09;
const LF = 0x0a;
const SPACE = 0x20;
const FIRST_NON_CONTROL = 0x20;
const SURROGATE_MIN = 0xd800;
const SURROGATE_MAX = 0xdfff;
const NON_CHARACTER_FFFE = 0xfffe;
const NON_CHARACTER_FFFF = 0xffff;
// Excel's escape of a character in cell text: it decodes `_x0041_` into 'A' when it
// opens the file. The writer neither escapes nor decodes it, so a text holding one is
// refused; the reader decodes it only in display text (`decodeExcelEscapes`), never in
// a value that is written back or compared with the file.
const EXCEL_CHARACTER_ESCAPE_RE = /_x[0-9A-Fa-f]{4}_/;

/**
 * Whether one code point may appear in a written text cell. Follows the XML 1.0
 * `Char` production (no C0 controls other than TAB and LF, no U+FFFE or U+FFFF, no
 * lone surrogate) and also refuses CR: every XML parser normalizes a literal CR to
 * LF, so it could never be read back as written. Iterating a string with `for...of`
 * yields a valid surrogate pair as one astral code point, so only an unpaired
 * surrogate reaches the surrogate range here.
 */
function isWritableCodePoint(codePoint: number): boolean {
  if (codePoint === TAB || codePoint === LF) return true;
  if (codePoint < FIRST_NON_CONTROL) return false;
  if (codePoint >= SURROGATE_MIN && codePoint <= SURROGATE_MAX) return false;
  return codePoint !== NON_CHARACTER_FFFE && codePoint !== NON_CHARACTER_FFFF;
}

/**
 * Every code point is an XML 1.0 `Char` other than CR, U+FFFE and U+FFFF (TAB and LF
 * pass), and the text holds no `_xHHHH_` escape: Excel would decode it on open, so the
 * cell would not read back unchanged.
 */
export function isWritableText(text: string): boolean {
  if (EXCEL_CHARACTER_ESCAPE_RE.test(text)) return false;
  for (const char of text) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined || !isWritableCodePoint(codePoint)) return false;
  }
  return true;
}

function fractionDigits(value: string): number {
  const point = value.indexOf(DECIMAL_POINT);
  return point === -1 ? 0 : value.length - point - 1;
}

function assertWritableNumber(value: string, scale: number | undefined): void {
  if (value.length > MAX_PATCH_NUMBER_LENGTH) {
    throw invalidPatchRequest(
      `number value is ${value.length} characters long, above ${MAX_PATCH_NUMBER_LENGTH}`,
    );
  }
  if (!PLAIN_DECIMAL_RE.test(value)) {
    throw invalidPatchRequest('number value is not a plain decimal');
  }
  if (scale === undefined) return;
  if (!Number.isInteger(scale) || scale < 0) {
    throw invalidPatchRequest(`number scale must be a non-negative integer, got ${String(scale)}`);
  }
  if (fractionDigits(value) !== scale) {
    throw invalidPatchRequest(`number value does not have exactly ${scale} fraction digits`);
  }
}

function assertWritableTextValue(value: string): void {
  if (value.length > MAX_PATCH_TEXT_LENGTH) {
    throw invalidPatchRequest(
      `text value is ${value.length} characters long, above ${MAX_PATCH_TEXT_LENGTH}`,
    );
  }
  if (!isWritableText(value)) {
    throw invalidPatchRequest(
      'text value holds a character XML cannot carry or an Excel _xHHHH_ escape',
    );
  }
}

/**
 * Throws, before any byte is written, when a value cannot be represented safely. A
 * length is checked before the characters, so an oversized value is never walked.
 */
export function assertWritableValue(value: CellPatchValue): void {
  switch (value.kind) {
    case 'number':
      assertWritableNumber(value.value, value.scale);
      return;
    case 'text':
      assertWritableTextValue(value.value);
      return;
    case 'clear':
      return;
    default: {
      const _exhaustive: never = value;
      throw new Error(`Unhandled cell value kind: ${String(_exhaustive)}`);
    }
  }
}

/** Escapes text for element content: `&`, `<` and `>` only (quotes need no escape there). */
export function escapeXmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function isPreservedSpace(codeUnit: number): boolean {
  return codeUnit === SPACE || codeUnit === TAB || codeUnit === LF;
}

/** True when the first or the last character is a space, TAB or LF (needs `xml:space="preserve"`). */
export function needsSpacePreserve(text: string): boolean {
  if (text.length === 0) return false;
  return isPreservedSpace(text.charCodeAt(0)) || isPreservedSpace(text.charCodeAt(text.length - 1));
}
