// Shared pieces of the tariff/campaign/discount scenario screens: the wire reason and the
// stored-value helpers the tariff services read their prices and commission percents through.
//
// Every one of these screens serializes the same not-calculable reason, so it lives here
// regardless of which engine produces it. The unit-assembly helpers that once sat beside it
// (the old assembly context and its commission/variant shims) are gone now that every screen
// prices on the scenario engine (Faz 4B); `scenario-screen-commons.ts` maps the engine's
// issues onto this reason. The stored-value helpers turn a nullable money or percent column
// into a `decimal.js` value or its wire text, so an unknown (null) price or commission
// percent stays null on every tariff page and is never priced.

import { Decimal } from 'decimal.js';

import type { Prisma } from '@pazarsync/db';

// --- Why an item cannot be costed ---

export type TariffItemReason = 'NO_PRODUCT' | 'NO_COST' | 'NO_SHIPPING';

// --- Stored prices ---

/**
 * A money value on the wire: its text with two decimals, or null when the value is
 * unknown. Takes a stored column (`Prisma.Decimal`) or a computed `decimal.js` value.
 */
export function moneyOrNull(
  value: { toFixed(decimalPlaces: number): string } | null,
): string | null {
  return value === null ? null : value.toFixed(2);
}

/**
 * A commission percent on the wire: its text with four decimals, or null when the
 * percent is unknown (the file's cell was blank or unreadable). A known 0 stays `0.0000`.
 */
export function percentOrNull(
  value: { toFixed(decimalPlaces: number): string } | null,
): string | null {
  return value === null ? null : value.toFixed(4);
}

/**
 * A stored nullable money or percent column as a `decimal.js` value, null kept as null.
 */
export function decimalOrNull(value: Prisma.Decimal | null): Decimal | null {
  return value === null ? null : new Decimal(value.toString());
}

/**
 * The current scenario's price: the item's commission-base price (the customer-seen
 * price commission is charged on), else its current sale price, as the detail row's
 * baseline. Null when neither is known (the file's cells were blank, unreadable or 0).
 */
export function currentBaselinePrice(item: {
  readonly commissionBasePrice: Prisma.Decimal | null;
  readonly currentPrice: Prisma.Decimal | null;
}): Decimal | null {
  const price = item.commissionBasePrice ?? item.currentPrice;
  return price === null ? null : new Decimal(price.toString());
}
