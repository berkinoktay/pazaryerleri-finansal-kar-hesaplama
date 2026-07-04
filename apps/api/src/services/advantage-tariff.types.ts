// Internal domain types for the saved Advantage Product Labels backend.
//
// The wire (request/response) contract lives in
// `validators/advantage-tariff.validator.ts`; this file holds the persisted
// star-tier JSON shape the service layer reasons with. Period validity + Trendyol
// period-label parsing are reused from `lib/tariff-period.ts` (via the commission
// tariff that supplies the rate). Band lookup reuses `commission-tariff.types.ts`
// (`StoredBand`) and `commission-tariff-compute.service.ts` (`bandForPrice`).

import type { Prisma } from '@pazarsync/db';

// ─── Persisted star-tier JSON ──────────────────────────────────────────────
//
// Trendyol's advantage tiers are PRICE RANGES: pricing at/below a tier's upper
// threshold earns that badge. tier1 = Avantaj, tier2 = Çok Avantaj, tier3 =
// Süper Avantaj (no lower limit — "ve altı"). Money is kept as decimal STRINGS.
// There is NO commission here — the reduced rate is looked up from the seller's
// Commission Tariff at compute time (the price lands into a commission band).

export const STAR_TIER_KEYS = ['tier1', 'tier2', 'tier3'] as const;
export type StarTierKey = (typeof STAR_TIER_KEYS)[number];

export interface StarTier {
  readonly key: StarTierKey;
  readonly upperLimit: string;
  readonly lowerLimit: string | null;
}

function isStarTierKey(value: unknown): value is StarTierKey {
  return typeof value === 'string' && (STAR_TIER_KEYS as readonly string[]).includes(value);
}

/**
 * Parses the persisted `starTiers` JSON into a typed array, dropping any entry
 * that does not match the expected shape. Returns `[]` for a non-array value.
 * `lowerLimit` is `null` when absent or not a string (tier3 has none). No type
 * assertions: every field is runtime checked, so malformed rows degrade to an
 * empty tier list rather than throwing.
 */
export function parseStarTiers(value: Prisma.JsonValue): StarTier[] {
  if (!Array.isArray(value)) return [];

  const tiers: StarTier[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const { key, upperLimit, lowerLimit } = entry;
    if (isStarTierKey(key) && typeof upperLimit === 'string') {
      tiers.push({
        key,
        upperLimit,
        lowerLimit: typeof lowerLimit === 'string' ? lowerLimit : null,
      });
    }
  }
  return tiers;
}
