import { planWindowFiles } from '@pazarsync/utils';

import type { CommissionTariffRow } from '../types';
import type { PlusTariffRow } from './adapt-plus-tariff';
import { asBandKey } from './band-key';
import type { CustomPriceMap, SelectionMap } from './bulk-actions';
import { findBand } from './commission-tariff-summary';
import type { PlusCustomPriceMap, PlusSelectionMap } from './plus-bulk-actions';

/** One window file the export will produce: its day count + the number of products in it. */
export interface ExportPreviewFile {
  readonly dayCount: number;
  readonly count: number;
}

/** Minimal per-period shape the preview needs (a full detail period satisfies it). */
interface PreviewPeriod<R> {
  readonly dayCount: number | null;
  readonly rows: readonly R[];
}

/**
 * Previews, without a round-trip, which window files a split-week tariff download
 * produces and how many products each holds. It runs the export's own window plan
 * (`planWindowFiles`) over the price each row would be written with, so the counts
 * match what actually downloads: a product picked at the same price in every
 * sub-period lands in the whole-week file, otherwise in each picking period's file.
 *
 * `resolve` returns the row's export price (a server `toFixed(2)` string), or null
 * when the row is not selected. Rows are keyed by barcode with the last row winning,
 * as in the export, so a repeated barcode counts once.
 */
export function computeExportPreview<R extends { readonly barcode: string }>(
  periods: readonly PreviewPeriod<R>[],
  resolve: (row: R) => string | null,
): ExportPreviewFile[] {
  const inputs = periods.map((period) => {
    const picks = new Map<string, string>();
    for (const row of period.rows) {
      const price = resolve(row);
      if (price !== null) picks.set(row.barcode, price);
    }
    return { dayCount: period.dayCount, picks };
  });
  return planWindowFiles(inputs).map((file) => ({
    dayCount: file.dayCount,
    count: file.picks.size,
  }));
}

/**
 * The price the commission export writes for a row, or null when the row is not
 * selected. Mirrors the export (custom price, else the chosen band's price, else the
 * current price) and the save payload, which treats a key outside the four bands as
 * no selection. It only picks server strings; it does no arithmetic.
 */
export function resolveCommissionExportPrice(
  row: CommissionTariffRow,
  selection: Readonly<SelectionMap>,
  customPrices: Readonly<CustomPriceMap>,
): string | null {
  const band = asBandKey(selection[row.id] ?? null);
  if (band === undefined) return null;
  return customPrices[row.id]?.price ?? findBand(row, band)?.price ?? row.currentPrice;
}

/**
 * The price the Plus export writes for a row, or null when the row is not joined.
 * Mirrors the export (custom price, else the ceiling) and the save rule (joined when
 * custom-priced or ceiling-joined). It only picks server strings; it does no arithmetic.
 */
export function resolvePlusExportPrice(
  row: PlusTariffRow,
  selection: Readonly<PlusSelectionMap>,
  customPrices: Readonly<PlusCustomPriceMap>,
): string | null {
  return (
    customPrices[row.id]?.price ??
    (selection[row.id] === 'plus' ? (row.bands[0]?.price ?? null) : null)
  );
}
