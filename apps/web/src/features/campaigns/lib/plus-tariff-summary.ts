import { Decimal } from 'decimal.js';

import type { PlusScenario, PlusTariffDetailItem } from '../types';
import { type PlusCustomPriceMap, type PlusSelectionMap } from './plus-bulk-actions';

export interface PlusTariffSummary {
  /** Products listed in this Plus window. */
  total: number;
  /** Products the seller has joined Plus for. */
  joinedCount: number;
  /** Sum of the joined products' PLUS-scenario profit — the estimated total if joined. */
  joinedProfit: Decimal;
  /** Sum of every product's CURRENT-scenario profit — the "do nothing" baseline. */
  currentProfit: Decimal;
}

/** A scenario's net profit as a Decimal, or zero when the row is not calculable. */
function profitOrZero(scenario: PlusScenario): Decimal {
  return scenario.netProfit !== null ? new Decimal(scenario.netProfit) : new Decimal(0);
}

/** A raw net-profit string as a Decimal, or zero when null. */
function stringProfitOrZero(netProfit: string | null): Decimal {
  return netProfit !== null ? new Decimal(netProfit) : new Decimal(0);
}

/**
 * Aggregate the seller's Plus opt-in choices for the header KPI strip. This only
 * SUMS already-computed profit figures for display — it does not calculate
 * profit/commission/VAT (that is the backend engine's job, per the no
 * frontend-financial-calculation rule). Uncalculable scenarios contribute zero.
 *
 * A row is joined either at the CEILING (`selection[id] === true`, whose profit is
 * `row.plus.netProfit`) or at a CUSTOM price (`customPrices[id] != null`, whose
 * profit was captured from the estimate at confirm time) — never both.
 */
export function summarizePlusSelection(
  rows: readonly PlusTariffDetailItem[],
  selection: PlusSelectionMap,
  customPrices: PlusCustomPriceMap,
): PlusTariffSummary {
  let joinedCount = 0;
  let joinedProfit = new Decimal(0);
  let currentProfit = new Decimal(0);

  for (const row of rows) {
    currentProfit = currentProfit.add(profitOrZero(row.current));
    const custom = customPrices[row.id];
    if (custom != null) {
      joinedCount += 1;
      joinedProfit = joinedProfit.add(stringProfitOrZero(custom.netProfit));
    } else if (selection[row.id] === true) {
      joinedCount += 1;
      joinedProfit = joinedProfit.add(profitOrZero(row.plus));
    }
  }

  return { total: rows.length, joinedCount, joinedProfit, currentProfit };
}
