/**
 * Barem price tables (Trendyol, 10 August 2026). An order inside the Barem limits pays
 * table 1 when it carries a fast-delivery promise and was handed to the carrier by
 * Trendyol's agreed ship-by date, and table 2 otherwise. The return shipment of an
 * order that went out at table 1 is priced at table 1 when the tariff version says so.
 * Pure, no I/O.
 */

import { BaremTier } from '@pazarsync/db/enums';

/** The Barem price table: the database enum, so the engine and the tariff rows agree. */
export type TrendyolBaremTier = BaremTier;

/**
 * How the order's handover to the carrier relates to its fast-delivery promise:
 * `NOT_PROMISED` no promise; `NOT_SHIPPED` promised, not yet handed over;
 * `NO_DEADLINE` promised, no ship-by date known; `ON_TIME` / `LATE` handed over by /
 * after the ship-by date.
 */
export type TrendyolShipTiming =
  | 'ON_TIME'
  | 'LATE'
  | 'NOT_SHIPPED'
  | 'NO_DEADLINE'
  | 'NOT_PROMISED';

/** The order's own facts that decide its Barem table. */
export interface TrendyolBaremTierFacts {
  readonly fastDelivery: boolean;
  // Trendyol's agreed ship-by instant (true UTC); null when Trendyol sent none.
  readonly agreedDeliveryDate: Date | null;
  // The instant the parcel moved to Shipped (true UTC); null while not yet handed over.
  readonly actualShipDate: Date | null;
}

/**
 * The Barem table an order pays under the two-table rule. A promised order that has
 * not shipped yet, or whose ship-by date is unknown, is optimistically table 1; a
 * handover exactly at the ship-by instant is on time. Both instants are true UTC, so
 * they are compared in milliseconds.
 */
export function resolveTrendyolBaremTier(params: TrendyolBaremTierFacts): {
  readonly tier: TrendyolBaremTier;
  readonly shipTiming: TrendyolShipTiming;
} {
  const { fastDelivery, agreedDeliveryDate, actualShipDate } = params;
  if (!fastDelivery) {
    return { tier: BaremTier.TABLE_2, shipTiming: 'NOT_PROMISED' };
  }
  if (actualShipDate === null) {
    return { tier: BaremTier.TABLE_1, shipTiming: 'NOT_SHIPPED' };
  }
  if (agreedDeliveryDate === null) {
    return { tier: BaremTier.TABLE_1, shipTiming: 'NO_DEADLINE' };
  }
  if (actualShipDate.getTime() <= agreedDeliveryDate.getTime()) {
    return { tier: BaremTier.TABLE_1, shipTiming: 'ON_TIME' };
  }
  return { tier: BaremTier.TABLE_2, shipTiming: 'LATE' };
}

/**
 * The Barem table to look an order's forward leg up in, given the Barem bands of the
 * tariff version in force on the order date. A two-tier version (one carrying a
 * table 2 band) applies `resolveTrendyolBaremTier`. An older single-tier version keeps
 * the rule it was priced under: a fast-delivery order is looked up in table 1 whatever
 * its ship timing and any other order is not looked up in Barem at all, so an old
 * order's figure never changes. `tier` null = do not look Barem up; `shipTiming` is
 * always the order's real timing. The parcel line and the per-item standalone amounts
 * both use this one result.
 */
export function selectTrendyolBaremTier(params: {
  readonly attributes: TrendyolBaremTierFacts;
  readonly baremBands: ReadonlyArray<{ readonly tier: TrendyolBaremTier }>;
}): { readonly tier: TrendyolBaremTier | null; readonly shipTiming: TrendyolShipTiming } {
  const { attributes, baremBands } = params;
  const resolved = resolveTrendyolBaremTier(attributes);

  const isTwoTier = baremBands.some((band) => band.tier === BaremTier.TABLE_2);
  if (isTwoTier) {
    return resolved;
  }

  return {
    tier: attributes.fastDelivery ? BaremTier.TABLE_1 : null,
    shipTiming: resolved.shipTiming,
  };
}

/**
 * The Barem table to look an order's return leg up in: table 1 when the tariff version
 * prices Barem returns (`appliesToReturns`) and the forward leg was priced at Barem
 * table 1, otherwise null (the desi tariff). The return leg's own Barem limits (its
 * desi, its returned sale inside a table 1 band) are checked by the tariff lookup.
 */
export function selectTrendyolReturnBaremTier(params: {
  readonly appliesToReturns: boolean;
  // The table the forward leg was priced at; null when it was not priced at Barem.
  readonly outboundBaremTier: TrendyolBaremTier | null;
}): TrendyolBaremTier | null {
  const { appliesToReturns, outboundBaremTier } = params;
  if (appliesToReturns && outboundBaremTier === BaremTier.TABLE_1) {
    return BaremTier.TABLE_1;
  }
  return null;
}
