import { Decimal } from 'decimal.js';

import type { CommissionTariffRow, PriceBand } from '../types';

export interface TariffSelectionSummary {
  /** Products listed in the active period. */
  total: number;
  /** Products the seller has chosen a band for. */
  selectedCount: number;
  /** Sum of the chosen bands' (pre-computed) profit. Pure display aggregation. */
  selectedProfit: Decimal;
  /** Sum of every product's best-band profit — the best-case target. */
  bestProfit: Decimal;
}

export function findBand(row: CommissionTariffRow, key: string): PriceBand | undefined {
  return row.bands.find((band) => band.key === key);
}

/** A band's net profit as a Decimal, or zero when the row is not calculable. */
function bandProfitOrZero(band: PriceBand | undefined): Decimal {
  if (band === undefined || band.netProfit === null) return new Decimal(0);
  return new Decimal(band.netProfit);
}

/**
 * Aggregate the seller's band choices for the header KPI strip. This only SUMS
 * already-computed per-row profit figures for display — it does not calculate
 * profit/commission/VAT (that is the backend engine's job, per the no
 * frontend-financial-calculation rule). Uncalculable bands contribute zero.
 */
export function summarizeSelection(
  rows: readonly CommissionTariffRow[],
  selection: Readonly<Record<string, string | null>>,
): TariffSelectionSummary {
  let selectedCount = 0;
  let selectedProfit = new Decimal(0);
  let bestProfit = new Decimal(0);

  for (const row of rows) {
    const best = row.bestBandKey !== null ? findBand(row, row.bestBandKey) : undefined;
    bestProfit = bestProfit.add(bandProfitOrZero(best));

    const chosen = selection[row.id];
    if (chosen === undefined || chosen === null) continue;
    const band = findBand(row, chosen);
    if (band !== undefined) {
      selectedCount += 1;
      selectedProfit = selectedProfit.add(bandProfitOrZero(band));
    }
  }

  return { total: rows.length, selectedCount, selectedProfit, bestProfit };
}
