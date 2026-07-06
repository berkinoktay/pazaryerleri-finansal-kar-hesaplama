import { Decimal } from 'decimal.js';

import type { AdvantageTariffRow } from './adapt-advantage-tariff';
import {
  bandForKey,
  type AdvantageCustomPriceMap,
  type AdvantageSelectionMap,
} from './advantage-bulk-actions';

export interface AdvantageTariffSummary {
  /** Products listed in this Advantage upload. */
  total: number;
  /** Products the seller has chosen a tier (or custom price) for. */
  joinedCount: number;
  /** Sum of the joined products' chosen-scenario profit — the estimated total if applied. */
  joinedProfit: Decimal;
  /** Sum of every product's CURRENT-scenario profit — the "do nothing" baseline. */
  currentProfit: Decimal;
}

/** A raw net-profit string as a Decimal, or zero when null. */
function stringProfitOrZero(netProfit: string | null): Decimal {
  return netProfit !== null ? new Decimal(netProfit) : new Decimal(0);
}

/**
 * Aggregate the seller's Advantage tier choices for the header KPI strip. This only SUMS
 * already-computed profit figures for display — it does not calculate
 * profit/commission/VAT (that is the backend engine's job, per the no
 * frontend-financial-calculation rule). Uncalculable scenarios contribute zero.
 *
 * A row is joined either at a STAR TIER (`selection[id]` set, whose profit is that tier's
 * `netProfit`) or at a CUSTOM price (`customPrices[id] != null`, whose profit was captured
 * from the estimate at confirm time) — never both.
 */
export function summarizeAdvantageSelection(
  rows: readonly AdvantageTariffRow[],
  selection: AdvantageSelectionMap,
  customPrices: AdvantageCustomPriceMap,
): AdvantageTariffSummary {
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
      const tierKey = selection[row.id];
      if (tierKey != null) {
        joinedCount += 1;
        const band = bandForKey(row, tierKey);
        joinedProfit = joinedProfit.add(stringProfitOrZero(band?.netProfit ?? null));
      }
    }
  }

  return { total: rows.length, joinedCount, joinedProfit, currentProfit };
}
