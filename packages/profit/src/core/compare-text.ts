/**
 * Lexicographic comparison by UTF-16 code units: the single text order the profit
 * package uses for record ids, cargo keys and stored id lists. Locale-independent,
 * so an order never depends on the runtime's collation.
 */
export function compareText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
