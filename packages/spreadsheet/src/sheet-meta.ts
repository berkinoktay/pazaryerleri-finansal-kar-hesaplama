/** Converts an Excel column-letter reference (e.g. "AI") to a 1-based column number. */
export function colRefToNumber(ref: string): number {
  let n = 0;
  for (const ch of ref) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
