import type { SheetSchema } from './types';
import { SpreadsheetFileError } from './errors';

/** Normalize a raw header cell to its canonical form.
 *  Steps: NFC unicode normalization -> convert NBSP (U+00A0) to space -> trim -> collapse runs of whitespace.
 */
export function normalizeHeader(s: string): string {
  return s
    .normalize('NFC')
    .replace(/\u00a0/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

interface ResolveResult {
  readonly canonicalHeaderRow: string[];
  readonly missingExpectedHeaders: string[];
  readonly presentKeys: Set<string>;
}

/** Resolve raw header row cells against a SheetSchema.
 *  - Alias cells are replaced with the canonical header string.
 *  - Unknown headers are passed through unchanged.
 *  - Throws AMBIGUOUS_HEADERS if the same normalized value maps to two different canonical headers.
 *  - Throws MISSING_REQUIRED_HEADERS when any columnRequired column is absent.
 *  - Populates missingExpectedHeaders for optional columns that are absent.
 */
export function resolveHeaders<TRow>(
  schema: SheetSchema<TRow>,
  rawHeaderRow: readonly unknown[],
): ResolveResult {
  // Build normalized-name -> canonical-header map; detect collisions.
  const aliasToCanonical = new Map<string, string>();
  for (const col of schema.columns) {
    const canon = normalizeHeader(col.header);
    for (const name of [col.header, ...(col.aliases ?? [])]) {
      const n = normalizeHeader(name);
      const existing = aliasToCanonical.get(n);
      if (existing !== undefined && existing !== canon) {
        throw new SpreadsheetFileError('AMBIGUOUS_HEADERS', `Header/alias collision on "${n}"`, {
          header: n,
        });
      }
      aliasToCanonical.set(n, canon);
    }
  }

  // Resolve raw header cells to canonical names.
  const canonicalHeaderRow: string[] = [];
  const presentCanonicals = new Set<string>();
  for (const cell of rawHeaderRow) {
    const n = normalizeHeader(String(cell ?? ''));
    const canon = aliasToCanonical.get(n);
    canonicalHeaderRow.push(canon ?? n);
    if (canon !== undefined) {
      presentCanonicals.add(canon);
    }
  }

  // Classify each schema column as present, missing-required, or missing-optional.
  const presentKeys = new Set<string>();
  const missingExpectedHeaders: string[] = [];
  const missingRequired: string[] = [];
  for (const col of schema.columns) {
    const canon = normalizeHeader(col.header);
    if (presentCanonicals.has(canon)) {
      presentKeys.add(col.key);
    } else if (col.columnRequired === true) {
      missingRequired.push(col.header);
    } else {
      missingExpectedHeaders.push(col.header);
    }
  }

  if (missingRequired.length > 0) {
    throw new SpreadsheetFileError(
      'MISSING_REQUIRED_HEADERS',
      `Missing required headers: ${missingRequired.join(', ')}`,
      { headers: missingRequired },
    );
  }

  return { canonicalHeaderRow, missingExpectedHeaders, presentKeys };
}
