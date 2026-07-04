import { Decimal } from 'decimal.js';

import type { AdvantageTariffDetailItem } from '../types';
import {
  tierForKey,
  type AdvantageCustomPriceMap,
  type AdvantageTierMap,
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
 * Aggregate the seller's Advantage tier choices for the header KPI strip. This only
 * SUMS already-computed profit figures for display — it does not calculate
 * profit/commission/VAT (that is the backend engine's job, per the no
 * frontend-financial-calculation rule). Uncalculable scenarios contribute zero.
 *
 * A row is joined either at a STAR TIER (`tiers[id]` set, whose profit is that tier's
 * `netProfit`) or at a CUSTOM price (`customPrices[id] != null`, whose profit was
 * captured from the estimate at confirm time) — never both.
 */
export function summarizeAdvantageSelection(
  rows: readonly AdvantageTariffDetailItem[],
  tiers: AdvantageTierMap,
  customPrices: AdvantageCustomPriceMap,
): AdvantageTariffSummary {
  let joinedCount = 0;
  let joinedProfit = new Decimal(0);
  let currentProfit = new Decimal(0);

  for (const row of rows) {
    currentProfit = currentProfit.add(stringProfitOrZero(row.current.netProfit));
    const custom = customPrices[row.id];
    if (custom != null) {
      joinedCount += 1;
      joinedProfit = joinedProfit.add(stringProfitOrZero(custom.netProfit));
    } else {
      const tierKey = tiers[row.id];
      if (tierKey != null) {
        joinedCount += 1;
        const tier = tierForKey(row, tierKey);
        joinedProfit = joinedProfit.add(stringProfitOrZero(tier?.netProfit ?? null));
      }
    }
  }

  return { total: rows.length, joinedCount, joinedProfit, currentProfit };
}
