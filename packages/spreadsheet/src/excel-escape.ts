// Excel's escape of one character in cell text: `_x` (lower-case x), exactly four hex
// digits in any case, then `_`, seven characters in all. Excel (and Trendyol's writer)
// stores a line break as `_x000a_` and a literal `_x0041_` as `_x005F_x0041_`.
// Decoded for display text only: an anchor or a value compared with the stored file is
// read raw. Pure code: no regular expression, one pass by index.

/** `_x`: what every escape starts with. */
const ESCAPE_PREFIX = '_x';

/** `_x` + four hex digits + `_`. */
const ESCAPE_LENGTH = 7;

/** Where the hex digits start, after `_x`. */
const HEX_OFFSET = 2;

/** An escape names one UTF-16 code unit in four hex digits. */
const HEX_WIDTH = 4;

/** Where the closing `_` sits. */
const CLOSE_OFFSET = HEX_OFFSET + HEX_WIDTH;

const HEX_RADIX = 16;
const DECIMAL_DIGIT_COUNT = 10;
const UNDERSCORE = 0x5f;
const DIGIT_ZERO = 0x30;
const DIGIT_NINE = 0x39;
const UPPER_A = 0x41;
const UPPER_F = 0x46;
const LOWER_A = 0x61;
const LOWER_F = 0x66;

/** `hexDigitValue` of a character that is not a hex digit. */
const NOT_HEX = -1;

// The characters XML 1.0 can carry that four hex digits can name.
const TAB = 0x09;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const LEGAL_LOW_FIRST = 0x20;
const LEGAL_LOW_LAST = 0xd7ff;
const LEGAL_HIGH_FIRST = 0xe000;
const LEGAL_HIGH_LAST = 0xfffd;

// A character outside the Basic Multilingual Plane takes two code units, a high then a
// low surrogate: escaped one unit at a time, it is two escapes in a row.
const HIGH_SURROGATE_FIRST = 0xd800;
const HIGH_SURROGATE_LAST = 0xdbff;
const LOW_SURROGATE_FIRST = 0xdc00;
const LOW_SURROGATE_LAST = 0xdfff;

/** The value of a hex digit (any case), or NOT_HEX. */
function hexDigitValue(code: number): number {
  if (code >= DIGIT_ZERO && code <= DIGIT_NINE) return code - DIGIT_ZERO;
  if (code >= UPPER_A && code <= UPPER_F) return code - UPPER_A + DECIMAL_DIGIT_COUNT;
  if (code >= LOWER_A && code <= LOWER_F) return code - LOWER_A + DECIMAL_DIGIT_COUNT;
  return NOT_HEX;
}

/**
 * The code unit an escape starting at `at` names, or null when the seven characters at
 * `at` are not an escape. The caller has already matched `_x` at `at`.
 */
function escapedUnitAt(text: string, at: number): number | null {
  if (at + ESCAPE_LENGTH > text.length) return null;
  if (text.charCodeAt(at + CLOSE_OFFSET) !== UNDERSCORE) return null;
  let unit = 0;
  for (let digit = 0; digit < HEX_WIDTH; digit += 1) {
    const value = hexDigitValue(text.charCodeAt(at + HEX_OFFSET + digit));
    if (value === NOT_HEX) return null;
    unit = unit * HEX_RADIX + value;
  }
  return unit;
}

/** Whether XML 1.0 can carry the code unit: no NUL, no other C0 control, no surrogate, no U+FFFE/U+FFFF. */
function isLegalXmlUnit(unit: number): boolean {
  return (
    unit === TAB ||
    unit === LINE_FEED ||
    unit === CARRIAGE_RETURN ||
    (unit >= LEGAL_LOW_FIRST && unit <= LEGAL_LOW_LAST) ||
    (unit >= LEGAL_HIGH_FIRST && unit <= LEGAL_HIGH_LAST)
  );
}

/**
 * The low surrogate the escape right after the high surrogate escape at `at` names, or
 * null when no escape of a low surrogate starts there.
 */
function pairedLowSurrogateAt(text: string, at: number): number | null {
  const next = at + ESCAPE_LENGTH;
  if (!text.startsWith(ESCAPE_PREFIX, next)) return null;
  const unit = escapedUnitAt(text, next);
  if (unit === null || unit < LOW_SURROGATE_FIRST || unit > LOW_SURROGATE_LAST) return null;
  return unit;
}

/**
 * `text` with every `_xHHHH_` escape of a legal XML 1.0 character decoded, in one
 * left-to-right pass that never rescans its own output: `_x005F_x0041_` reads
 * `_x0041_`, `_x0041__x0042_` reads `AB` and `_x0041_x0042_` reads `Ax0042_` (the
 * closing `_` of one escape never opens the next). A high surrogate escape followed at
 * once by a low surrogate escape is one character, as Excel reads it: `_xD83D__xDE00_`
 * reads U+1F600. An escape of a character XML cannot carry (`_x0000_`, another C0
 * control, an unpaired surrogate, `_xFFFE_`, `_xFFFF_`) is kept as written and skipped
 * whole, so the output never gains a U+0000 or a lone surrogate. Returns `text` itself
 * when nothing is decoded.
 */
export function decodeExcelEscapes(text: string): string {
  let at = text.indexOf(ESCAPE_PREFIX);
  if (at === -1) return text;

  const parts: string[] = [];
  let copiedTo = 0;
  while (at !== -1) {
    const unit = escapedUnitAt(text, at);
    if (unit === null) {
      // Not an escape: the '_' is plain text; the next candidate starts after it.
      at = text.indexOf(ESCAPE_PREFIX, at + 1);
      continue;
    }
    const low =
      unit >= HIGH_SURROGATE_FIRST && unit <= HIGH_SURROGATE_LAST
        ? pairedLowSurrogateAt(text, at)
        : null;
    if (low !== null) {
      parts.push(text.slice(copiedTo, at), String.fromCharCode(unit, low));
      copiedTo = at + 2 * ESCAPE_LENGTH;
      at = text.indexOf(ESCAPE_PREFIX, copiedTo);
      continue;
    }
    if (isLegalXmlUnit(unit)) {
      parts.push(text.slice(copiedTo, at), String.fromCharCode(unit));
      copiedTo = at + ESCAPE_LENGTH;
    }
    // An illegal escape stays in the copied text; either way the scan resumes after it.
    at = text.indexOf(ESCAPE_PREFIX, at + ESCAPE_LENGTH);
  }
  if (copiedTo === 0) return text;
  parts.push(text.slice(copiedTo));
  return parts.join('');
}
