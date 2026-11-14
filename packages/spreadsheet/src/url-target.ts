// The one rule the gate reads a URL or a relationship Target by: whether its decoded text
// names something outside the package. A URL parser drops the C0 controls and spaces
// before a URL and removes ASCII tab and line breaks wherever they stand, so the text is
// read the same way: it leaves the package when it holds a backslash anywhere (Windows
// reads one in a path), or when, past those leading code units, it starts with '//' (a
// network path), with a drive letter written C| (C|/x is C:/x to a URL parser), or with a
// URI scheme up to its ':' (an ASCII letter, then letters, digits, '+', '-' or '.'; the
// drive letter C: is one). Shared by the content scan (URL attributes, styles and the
// `url(` of any attribute value) and the relationship Target rule. The start of a URL
// is read one code unit at a time (UrlStartReader), so the content scan can read the
// text of a style that comes in pieces without joining them.

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

/** Where an incremental read of the start of a URL stands (UrlStartReader). */
type UrlStartPhase =
  // Before the first code unit a URL parser keeps: C0 controls and spaces are skipped.
  | 'lead'
  // Past a first '/': a second one makes a network path.
  | 'slash'
  // Past a first ASCII letter: '|' makes a drive letter, ':' a scheme (C: among them).
  | 'letter'
  // Past two or more scheme characters: ':' ends a scheme.
  | 'scheme';

/** What the code units read so far say: the URL starts outside the package, it does not, or not yet known. */
export type UrlStartVerdict = 'absolute' | 'relative' | 'pending';

/**
 * The start of a URL read one code unit at a time (see startsAbsoluteUrl), so a caller
 * that gets its text in pieces keeps no copy of it. Create with createUrlStartReader,
 * feed with readUrlStart until it decides; text that ends while it is pending is
 * relative.
 */
export interface UrlStartReader {
  phase: UrlStartPhase;
}

export function createUrlStartReader(): UrlStartReader {
  return { phase: 'lead' };
}

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

/**
 * Reads code unit `code`, the next of the URL start `reader` stands in: the verdict
 * once it decides, 'pending' before. Past the C0 controls and spaces a URL parser drops,
 * a start of '//', a drive letter written C|, or a URI scheme up to its ':' is absolute,
 * anything else relative; URL_REMOVED code units past the first kept one are skipped.
 */
export function readUrlStart(reader: UrlStartReader, code: number): UrlStartVerdict {
  const phase = reader.phase;
  switch (phase) {
    case 'lead':
      if (code <= SPACE) return 'pending';
      if (code === SLASH) {
        reader.phase = 'slash';
        return 'pending';
      }
      if (!isAsciiLetter(code)) return 'relative';
      reader.phase = 'letter';
      return 'pending';
    case 'slash':
      if (URL_REMOVED.has(code)) return 'pending';
      return code === SLASH ? 'absolute' : 'relative';
    case 'letter':
    case 'scheme':
      if (URL_REMOVED.has(code)) return 'pending';
      if (code === COLON || (phase === 'letter' && code === DRIVE_LETTER_BAR)) return 'absolute';
      if (!isSchemeCharacter(code)) return 'relative';
      reader.phase = 'scheme';
      return 'pending';
    default: {
      const _exhaustive: never = phase;
      throw new Error(`Unhandled URL start phase: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Whether the text of `value` from `from` starts a URL outside the package (see the
 * header), its backslashes left to the caller: past the C0 controls and spaces a URL
 * parser drops, a start of '//', a drive letter written C|, or a URI scheme up to its
 * ':' (C: among them), URL_REMOVED code units skipped (readUrlStart). Reads up to the
 * first code unit that decides, so a caller may pass a longer text whose URL ends at a
 * quote or a ')'.
 */
export function startsAbsoluteUrl(value: string, from: number): boolean {
  const reader = createUrlStartReader();
  for (let at = from; at < value.length; at += 1) {
    const verdict = readUrlStart(reader, value.charCodeAt(at));
    if (verdict !== 'pending') return verdict === 'absolute';
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
