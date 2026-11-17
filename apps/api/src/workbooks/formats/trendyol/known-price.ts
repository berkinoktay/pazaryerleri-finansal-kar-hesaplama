// Whether a price cell a Trendyol tariff workbook holds is a known price. Shared by the
// tariff formats so a blank, unreadable or zero price is read the same way on every page.

import { Decimal } from 'decimal.js';

/** The scale of the stored price columns (numeric(12,2)). */
export const STORED_PRICE_SCALE = 2;

/**
 * A price cell's decimal text, or null when the price is unknown: the cell read as no
 * decimal (`raw` null), or its value is zero at the stored scale. `0.004` would store
 * as `0.00`, which is no price either. Any other value is kept as the file's own text.
 */
export function knownPrice(raw: string | null): string | null {
  if (raw === null) return null;
  return new Decimal(raw).toDecimalPlaces(STORED_PRICE_SCALE).isZero() ? null : raw;
}
