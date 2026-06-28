import { FORMULA_PREFIX_CHARS } from './constants';

/**
 * Neutralizes formula/CSV injection: if the first non-space character (including dangerous whitespace like tab, CR, LF) is dangerous, prepend `'`.
 * Only applied to text cells (numeric/date types are written as typed cells).
 */
export function sanitizeCellText(input: string): string {
  const firstNonSpace = input.search(/[^ ]/);
  if (firstNonSpace === -1) return input; // all spaces or empty
  const ch = input.charAt(firstNonSpace);
  return FORMULA_PREFIX_CHARS.includes(ch) ? `'${input}` : input;
}
