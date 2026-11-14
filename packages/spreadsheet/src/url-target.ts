// The one rule the gate reads a URL or a relationship Target by: whether its decoded text
// names something outside the package. A URL parser drops the C0 controls and spaces
// before a URL and removes ASCII tab and line breaks wherever they stand, so the text is
// read the same way: it leaves the package when it holds a backslash anywhere (Windows
// reads one in a path), or when, past those leading code units, it starts with '//' (a
// network path), with a drive letter written C| (C|/x is C:/x to a URL parser), or with a
// URI scheme up to its ':' (an ASCII letter, then letters, digits, '+', '-' or '.'; the
// drive letter C: is one). Shared by the content scan (URL attributes and styles) and
// the relationship Target rule.

const BACKSLASH = '\\';
const SLASH = 0x2f;
const COLON = 0x3a;
const SPACE = 0x20;
// What a URL parser removes wherever it stands: ASCII tab and line breaks.
const URL_REMOVED: ReadonlySet<number> = new Set([0x09, 0x0a, 0x0d]);
// The punctuation a URI scheme may hold after its first letter: '+', '-' and '.'.
const URL_SCHEME_PUNCTUATION: ReadonlySet<number> = new Set([0x2b, 0x2d, 0x2e]);
// What follows the letter of a drive letter besides ':'.
const DRIVE_LETTER_BAR = 0x7c;
const UPPER_A = 0x41;
const UPPER_Z = 0x5a;
const LOWER_A = 0x61;
const LOWER_Z = 0x7a;
const DIGIT_ZERO = 0x30;
const DIGIT_NINE = 0x39;

function isAsciiLetter(code: number): boolean {
  return (code >= UPPER_A && code <= UPPER_Z) || (code >= LOWER_A && code <= LOWER_Z);
}

/** What a URI scheme holds after its first letter: ASCII letters, digits, '+', '-' and '.'. */
function isSchemeCharacter(code: number): boolean {
  return (
    isAsciiLetter(code) ||
    (code >= DIGIT_ZERO && code <= DIGIT_NINE) ||
    URL_SCHEME_PUNCTUATION.has(code)
  );
}

/** The index of the first code unit of `value` from `at` that a URL parser keeps (not URL_REMOVED). */
function keptUrlIndex(value: string, at: number): number {
  let index = at;
  while (index < value.length && URL_REMOVED.has(value.charCodeAt(index))) index += 1;
  return index;
}

/**
 * Whether the text of `value` from `from` starts a URL outside the package (see the
 * header), its backslashes left to the caller: past the C0 controls and spaces a URL
 * parser drops, a start of '//', a drive letter written C|, or a URI scheme up to its
 * ':' (C: among them), URL_REMOVED code units skipped. Reads up to the first code unit
 * that decides, so a caller may pass a longer text whose URL ends at a quote or a ')'.
 */
export function startsAbsoluteUrl(value: string, from: number): boolean {
  let start = from;
  while (start < value.length && value.charCodeAt(start) <= SPACE) start += 1;
  if (start >= value.length) return false;
  const first = value.charCodeAt(start);
  const next = keptUrlIndex(value, start + 1);
  if (first === SLASH) return next < value.length && value.charCodeAt(next) === SLASH;
  if (!isAsciiLetter(first)) return false;
  if (next < value.length && value.charCodeAt(next) === DRIVE_LETTER_BAR) return true;
  for (let at = next; at < value.length; at = keptUrlIndex(value, at + 1)) {
    const code = value.charCodeAt(at);
    if (code === COLON) return true;
    if (!isSchemeCharacter(code)) return false;
  }
  return false;
}

/**
 * Whether the decoded URL or Target text `value` names something outside the package
 * (see the header): a backslash anywhere, or a start that startsAbsoluteUrl reads as
 * one. One pass.
 */
export function isAbsoluteUrl(value: string): boolean {
  return value.includes(BACKSLASH) || startsAbsoluteUrl(value, 0);
}
