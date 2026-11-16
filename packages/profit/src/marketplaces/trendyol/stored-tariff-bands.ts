// The persisted commission-tariff band JSON shape and its parser, moved out of
// the backend so the profit engine's Trendyol loader can turn a stored tariff
// item into TrendyolCommissionBand inputs. The wire (request/response) contract
// still lives in the backend validators; this file holds only the persisted band
// JSON shape and the type guard that reads it. Period validity + Trendyol
// period-label parsing stay in the backend's `workbooks/tariff-week.ts`.

import { Decimal } from 'decimal.js';
import type { Prisma } from '@pazarsync/db';

import { trendyolBandForPrice } from './resolve-commission-rate';
import { type TrendyolCommissionBand } from './trendyol-inputs';

// --- Persisted band JSON ---
//
// Trendyol's tariff bands are PRICE RANGES, not single thresholds: each band is
// a [lowerLimit, upperLimit] window with its own commission. The seller drops
// the price into a lower window to earn a lower commission. Band 1 is the
// current tier (no upper limit -- the seller's current price applies); band 4 has
// no lower limit. Money is kept as decimal STRINGS; `commissionPct` is a PERCENT
// (e.g. "19", "13.1"), exactly as the Excel states it.

export interface StoredTariffBand {
  readonly key: string;
  readonly lowerLimit: string | null;
  readonly upperLimit: string | null;
  readonly commissionPct: string;
}

/**
 * Parses the persisted `bands` JSON into a typed array, dropping any entry that
 * does not match the expected shape. Returns `[]` for a non-array value. A limit
 * is `null` when its key is absent or not a string -- the persisted JSON OMITS
 * null limits (band 1 has no upper, band 4 no lower) so the stored value never
 * carries an explicit JSON null. No type assertions: every field is runtime
 * checked, so malformed rows degrade to an empty band list rather than throwing.
 */
export function parseStoredTariffBands(value: Prisma.JsonValue): StoredTariffBand[] {
  if (!Array.isArray(value)) return [];

  const bands: StoredTariffBand[] = [];
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

/**
 * A band's representative price = the boundary the seller SEES in that column: the upper
 * limit for the bounded bands (2-4, "X ve altı"), else the LOWER limit for the open-topped
 * band 1 ("X ve üzeri" — the cheapest price still in the top band). Trendyol's own panel
 * pins the price-update field to exactly this boundary regardless of the current price, and
 * the band's shown profit is computed at it — so selection, profit, and export all use one
 * number. currentPrice is only a defensive fallback for a band with neither limit.
 *
 * The current price may be unknown (null). A band with a limit still has its price;
 * null means "neither limit and the current price is unknown" -- the band has no price.
 * A caller holding a known current price gets a plain Decimal back (first overload).
 */
export function bandPrice(band: StoredTariffBand, currentPrice: Decimal): Decimal;
export function bandPrice(band: StoredTariffBand, currentPrice: Decimal | null): Decimal | null;
export function bandPrice(band: StoredTariffBand, currentPrice: Decimal | null): Decimal | null {
  if (band.upperLimit !== null) return new Decimal(band.upperLimit);
  if (band.lowerLimit !== null) return new Decimal(band.lowerLimit);
  return currentPrice;
}

/** One stored tariff band -> a Trendyol commission band; the rate is already a percent. */
export function toCommissionBand(band: StoredTariffBand): TrendyolCommissionBand {
  return {
    lowerLimit: band.lowerLimit === null ? null : new Decimal(band.lowerLimit),
    upperLimit: band.upperLimit === null ? null : new Decimal(band.upperLimit),
    ratePct: new Decimal(band.commissionPct),
  };
}

/**
 * The stored tariff band whose inclusive price range contains `price`, or null when
 * none does. It converts the stored bands to `TrendyolCommissionBand` in the same
 * order, defers the match to `trendyolBandForPrice` (the single band-resolution rule:
 * inclusive limits, first match wins, so a shared boundary resolves to the band listed
 * first -- the higher band), then maps the hit back to the stored band by index so its
 * `key` survives. A band-click therefore passes its own band explicitly; only a
 * free-form price relies on this lookup.
 */
export function storedTariffBandForPrice(
  bands: readonly StoredTariffBand[],
  price: Decimal,
): StoredTariffBand | null {
  const commissionBands = bands.map(toCommissionBand);
  const hit = trendyolBandForPrice(commissionBands, price);
  if (hit === null) {
    return null;
  }
  // `hit` is a member of `commissionBands` (same order as `bands`), so its index maps
  // straight back to the stored band. A -1 (never, defensively) reads undefined -> null.
  const index = commissionBands.indexOf(hit);
  return bands[index] ?? null;
}
