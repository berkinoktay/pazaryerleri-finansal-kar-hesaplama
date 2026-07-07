import { Decimal } from 'decimal.js';

import type { FlashProductRow } from './adapt-flash-product';
import { bandForKey, type FlashCustomPriceMap, type FlashSelectionMap } from './flash-bulk-actions';

export interface FlashProductSummary {
  /** Offer rows listed in this Flash upload (one product × one date each). */
  total: number;
  /** Rows the seller has chosen an offer (or custom price) for. */
  joinedCount: number;
  /** Sum of the joined rows' chosen-scenario profit — the estimated total if applied. */
  joinedProfit: Decimal;
  /** Sum of every row's CURRENT-scenario profit — the "do nothing" baseline. */
  currentProfit: Decimal;
}

/** A raw net-profit string as a Decimal, or zero when null. */
function stringProfitOrZero(netProfit: string | null): Decimal {
  return netProfit !== null ? new Decimal(netProfit) : new Decimal(0);
}

/**
 * Aggregate the seller's Flash offer choices for the header KPI strip. This only SUMS
 * already-computed profit figures for display — it does not calculate
 * profit/commission/VAT (that is the backend engine's job, per the no
 * frontend-financial-calculation rule). Uncalculable scenarios contribute zero.
 *
 * A row is joined either at a FLASH OFFER (`selection[id]` set, whose profit is that
 * offer's `netProfit`) or at a CUSTOM price (`customPrices[id] != null`, whose profit was
 * captured from the estimate at confirm time) — never both.
 */
export function summarizeFlashSelection(
  rows: readonly FlashProductRow[],
  selection: FlashSelectionMap,
  customPrices: FlashCustomPriceMap,
): FlashProductSummary {
  let joinedCount = 0;
  let joinedProfit = new Decimal(0);
  let currentProfit = new Decimal(0);

  for (const row of rows) {
    currentProfit = currentProfit.add(stringProfitOrZero(row.currentNetProfit));
    const custom = customPrices[row.id];
    if (custom != null) {
      joinedCount += 1;
      joinedProfit = joinedProfit.add(stringProfitOrZero(custom.netProfit));
    } else {
      const offerKey = selection[row.id];
      if (offerKey != null) {
        joinedCount += 1;
        const band = bandForKey(row, offerKey);
        joinedProfit = joinedProfit.add(stringProfitOrZero(band?.netProfit ?? null));
      }
    }
  }

  return { total: rows.length, joinedCount, joinedProfit, currentProfit };
}
