// Internal domain types for the saved Commission Tariffs backend.
//
// The wire (request/response) contract lives in
// `validators/commission-tariff.validator.ts`; this file holds the types the
// service layer reasons with internally — the persisted band JSON shape. Period
// validity + Trendyol period-label parsing are SHARED with the Plus tariff
// feature and live in `lib/tariff-period.ts`.

import type { Prisma } from '@pazarsync/db';

// ─── Persisted band JSON ───────────────────────────────────────────────────
//
// Trendyol's tariff bands are PRICE RANGES, not single thresholds: each band is
// a [lowerLimit, upperLimit] window with its own commission. The seller drops
// the price into a lower window to earn a lower commission. Band 1 is the
// current tier (no upper limit — the seller's current price applies); band 4 has
// no lower limit. Money is kept as decimal STRINGS; `commissionPct` is a PERCENT
// (e.g. "19", "13.1"), exactly as the Excel states it.

export interface StoredBand {
  readonly key: string;
  readonly lowerLimit: string | null;
  readonly upperLimit: string | null;
  readonly commissionPct: string;
}

/**
 * Parses the persisted `bands` JSON into a typed array, dropping any entry that
 * does not match the expected shape. Returns `[]` for a non-array value. A limit
 * is `null` when its key is absent or not a string — the persisted JSON OMITS
 * null limits (band 1 has no upper, band 4 no lower) so the stored value never
 * carries an explicit JSON null. No type assertions: every field is runtime
 * checked, so malformed rows degrade to an empty band list rather than throwing.
 */
export function parseStoredBands(value: Prisma.JsonValue): StoredBand[] {
  if (!Array.isArray(value)) return [];

  const bands: StoredBand[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const { key, lowerLimit, upperLimit, commissionPct } = entry;
    if (typeof key === 'string' && typeof commissionPct === 'string') {
      bands.push({
        key,
        lowerLimit: typeof lowerLimit === 'string' ? lowerLimit : null,
        upperLimit: typeof upperLimit === 'string' ? upperLimit : null,
        commissionPct,
      });
    }
  }
  return bands;
}
