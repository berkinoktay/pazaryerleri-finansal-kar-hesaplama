import type { CommissionSelectionState, CustomPriceMap, SelectionMap } from './bulk-actions';

const FULL_WEEK_DAYS = 7;

/**
 * "7 günlük" model for a split-week tariff (§ plus-tariff-multiperiod-parity design).
 *
 * A product appears once PER sub-period (same barcode, a distinct item id each), and
 * "7 günlük" ≡ its choice is identical across every sub-period — a derived state, not
 * a stored flag. These pure helpers map a product across periods and spread / unlink
 * its choice; the export then writes one "7 Günlük Fiyat" row when the choices match.
 * No money math — a copied custom price re-estimates per period in its own cell.
 */

/** Per-row "7 günlük" controls handed to the table / mobile cards. */
export interface WholeWeekControls {
  /** Is this product's choice identical (and non-empty) across every sub-period? */
  isActive: (rowId: string) => boolean;
  /** Does this product have a choice in the active period to spread over the week? */
  canApply: (rowId: string) => boolean;
  /** Spread the active choice to every period, or unlink (clear the other periods). */
  onToggle: (rowId: string) => void;
}

/** barcode → its item ids across every period, and the reverse lookup. */
export interface WholeWeekIndex {
  readonly rowIdsByBarcode: ReadonlyMap<string, readonly string[]>;
  readonly barcodeByRowId: ReadonlyMap<string, string>;
}

/** Minimal per-period shape the index needs (a full `TariffPeriod` satisfies it). */
interface PeriodRows {
  readonly rows: readonly { readonly id: string; readonly barcode: string }[];
}

/** `PeriodRows` plus the day count the export preview labels each window file with. */
interface PreviewPeriod extends PeriodRows {
  readonly dayCount: number | null;
}

export function buildWholeWeekIndex(periods: readonly PeriodRows[]): WholeWeekIndex {
  const rowIdsByBarcode = new Map<string, string[]>();
  const barcodeByRowId = new Map<string, string>();
  for (const period of periods) {
    for (const row of period.rows) {
      const ids = rowIdsByBarcode.get(row.barcode) ?? [];
      ids.push(row.id);
      rowIdsByBarcode.set(row.barcode, ids);
      barcodeByRowId.set(row.id, row.barcode);
    }
  }
  return { rowIdsByBarcode, barcodeByRowId };
}

/** This product's item ids across every sub-period (includes `rowId` itself). */
export function siblingRowIds(rowId: string, index: WholeWeekIndex): readonly string[] {
  const barcode = index.barcodeByRowId.get(rowId);
  if (barcode === undefined) return [rowId];
  return index.rowIdsByBarcode.get(barcode) ?? [rowId];
}

/** A product's choice folded into one comparable token (a custom price beats a band). */
export function choiceSignature(
  rowId: string,
  selection: SelectionMap,
  customPrices: CustomPriceMap,
): string | null {
  const custom = customPrices[rowId]?.price;
  if (custom != null) return `custom:${custom}`;
  return selection[rowId] ?? null;
}

/** True when every sibling period shares the SAME non-empty choice. */
export function isWholeWeek(
  ids: readonly string[],
  selection: SelectionMap,
  customPrices: CustomPriceMap,
): boolean {
  if (ids.length < 2) return false;
  const first = ids[0];
  if (first === undefined) return false;
  const sig = choiceSignature(first, selection, customPrices);
  if (sig === null) return false;
  return ids.every((id) => choiceSignature(id, selection, customPrices) === sig);
}

/** Copy `sourceRowId`'s choice (band + custom price) onto every sibling period. */
export function spreadToWeek(
  state: CommissionSelectionState,
  ids: readonly string[],
  sourceRowId: string,
): CommissionSelectionState {
  const band = state.selection[sourceRowId] ?? null;
  const custom = state.customPrices[sourceRowId] ?? null;
  const selection: SelectionMap = { ...state.selection };
  const customPrices: CustomPriceMap = { ...state.customPrices };
  for (const id of ids) {
    selection[id] = band;
    customPrices[id] = custom;
  }
  return { selection, customPrices };
}

/** Keep `keepRowId`'s choice; clear the other periods so each can differ again. */
export function unlinkWeek(
  state: CommissionSelectionState,
  ids: readonly string[],
  keepRowId: string,
): CommissionSelectionState {
  const selection: SelectionMap = { ...state.selection };
  const customPrices: CustomPriceMap = { ...state.customPrices };
  for (const id of ids) {
    if (id === keepRowId) continue;
    selection[id] = null;
    customPrices[id] = null;
  }
  return { selection, customPrices };
}

/** One window file the export will produce: its day count + the number of products in it. */
export interface ExportPreviewFile {
  readonly dayCount: number;
  readonly count: number;
}

/**
 * Mirrors the backend's export bucketing to preview — without a round-trip — which
 * window files a download produces and how many products each holds. A product priced
 * the same in every sub-period → the whole-week ("7 Günlük") file; a period-specific
 * price → that period's file. Whole-week detection uses the same choice signature as
 * the export (identical band / custom price across periods ⇒ identical resolved price),
 * so the preview counts match what actually downloads. Ordered 3-Gün, 4-Gün, then 7-Gün.
 */
export function computeExportPreview(
  periods: readonly PreviewPeriod[],
  selection: SelectionMap,
  customPrices: CustomPriceMap,
): ExportPreviewFile[] {
  if (periods.length === 0) return [];
  const weekDayCount = periods.reduce((sum, p) => sum + (p.dayCount ?? 0), 0) || FULL_WEEK_DAYS;

  if (periods.length === 1) {
    const only = periods[0];
    if (only === undefined) return [];
    const count = only.rows.filter(
      (row) => choiceSignature(row.id, selection, customPrices) !== null,
    ).length;
    return count > 0 ? [{ dayCount: only.dayCount ?? weekDayCount, count }] : [];
  }

  const index = buildWholeWeekIndex(periods);
  const wholeBarcodes = new Set<string>();
  for (const [barcode, ids] of index.rowIdsByBarcode) {
    if (isWholeWeek(ids, selection, customPrices)) wholeBarcodes.add(barcode);
  }

  const files: ExportPreviewFile[] = [];
  for (const period of periods) {
    const count = period.rows.filter(
      (row) =>
        !wholeBarcodes.has(row.barcode) &&
        choiceSignature(row.id, selection, customPrices) !== null,
    ).length;
    if (count > 0) files.push({ dayCount: period.dayCount ?? weekDayCount, count });
  }
  if (wholeBarcodes.size > 0) files.push({ dayCount: weekDayCount, count: wholeBarcodes.size });
  return files;
}
