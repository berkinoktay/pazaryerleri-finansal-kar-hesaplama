import { Decimal } from 'decimal.js';

import type { PlusScenario, PlusTariffDetailItem } from '../types';
import { isJoined, type PlusSelectionMap } from './plus-bulk-actions';

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

/**
 * Aggregate the seller's Plus opt-in choices for the header KPI strip. This only
 * SUMS already-computed per-scenario profit figures for display — it does not
 * calculate profit/commission/VAT (that is the backend engine's job, per the no
 * frontend-financial-calculation rule). Uncalculable scenarios contribute zero.
 */
export function summarizePlusSelection(
  rows: readonly PlusTariffDetailItem[],
  selection: PlusSelectionMap,
): PlusTariffSummary {
  let joinedCount = 0;
  let joinedProfit = new Decimal(0);
  let currentProfit = new Decimal(0);

  for (const row of rows) {
    currentProfit = currentProfit.add(profitOrZero(row.current));
    if (isJoined(selection, row.id)) {
      joinedCount += 1;
      joinedProfit = joinedProfit.add(profitOrZero(row.plus));
    }
  }

  return { total: rows.length, joinedCount, joinedProfit, currentProfit };
}
