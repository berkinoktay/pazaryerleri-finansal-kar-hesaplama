import { FORMULA_PREFIX_CHARS } from './constants';

/**
 * Neutralizes formula/CSV injection. Skips leading benign whitespace (ASCII
 * space, NBSP, and other Unicode whitespace) but NOT the whitespace danger
 * chars (\t \r \n), which must be detected at their position. If the first
 * danger-or-non-whitespace character is a formula prefix, prepend a quote.
 * Only applied to text cells (numeric/date values are written as typed cells).
 */
export function sanitizeCellText(input: string): string {
  let i = 0;
  while (i < input.length) {
    const ch = input.charAt(i);
    // Stop at the first char that is non-whitespace OR a danger char
    // (\t \r \n are whitespace but also danger chars and must not be skipped).
    if (!/\s/.test(ch) || FORMULA_PREFIX_CHARS.includes(ch)) break;
    i += 1;
  }
  if (i >= input.length) return input; // all skippable whitespace, or empty
  const ch = input.charAt(i);
  return FORMULA_PREFIX_CHARS.includes(ch) ? `'${input}` : input;
}
