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
 * The price the commission export writes for a row. Mirrors the backend pick step by
 * step:
 *   1. not selected: null (the save payload treats a key outside the four bands as no
 *      selection, so such a key is not selected either);
 *   2. a custom price: the custom price;
 *   3. the row holds the selected band: that band's price, null when it is unknown (a
 *      band with neither limit while the current price is unknown);
 *   4. the row lacks the selected band: the row's current price, null when unknown.
 *
 * A null result for a SELECTED row means the backend export would refuse it (409
 * `SELECTION_PRICE_UNKNOWN`); the preview then leaves the row out of every file. The
 * page cannot reach that state: the seed drops such a stored selection
 * (`seedCommissionSelection`) and a band with no price cannot be selected. It only
 * picks server strings; it does no arithmetic.
 */
export function resolveCommissionExportPrice(
  row: CommissionTariffRow,
  selection: Readonly<SelectionMap>,
  customPrices: Readonly<CustomPriceMap>,
): string | null {
  const bandKey = asBandKey(selection[row.id] ?? null);
  if (bandKey === undefined) return null;
  const custom = customPrices[row.id];
  if (custom != null) return custom.price;
  const band = findBand(row, bandKey);
  if (band !== undefined) return band.price;
  return row.currentPrice;
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
