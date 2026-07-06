// Export service for the saved Plus Commission Tariffs feature.
//
// Like the product tariff export, the seller re-uploads the result to Trendyol
// VERBATIM, so we patch their opt-in into the EXACT original file (kept at import
// as `sourceFile`) via the shared byte-preserving `patchXlsxCells` helper. Every
// other cell — including the raw file's uncached-formula helper columns — stays
// byte-for-byte intact.
//
// The exact filled-cell format was confirmed from a real filled Trendyol Plus
// export (the competitor "melontik" sample). For every product the seller opted
// into Plus, the following cells are written:
//   • "Plus Fiyat Seçimi" ← the chosen Plus price (custom, else the ceiling)
//   • "Tarife Seçimi"     ← "{N} Günlük Fiyat" (the window this file represents)
//   • "Hesaplanan Komisyon (N Gün)" ← the reduced Plus commission percent, ONE cell
//     per period the file covers (a whole-week file carries one price but a commission
//     cell for EACH sub-period, each at that period's own percent)
//   • "İptal" ← "Hayır" (confirm the offer, do not cancel)
//
// A single upload can carry MULTIPLE date-range periods (a 3-Gün + 4-Gün split week),
// so — like the product tariff — selections are bucketed by `planExportFiles` into up
// to three window files (7-Gün whole-week + 3-Gün + 4-Gün), only the non-empty ones,
// delivered as one .xlsx or a .zip. The bucketing + bundling live in
// `tariff-export-commons`; this service supplies the per-period price/commission maps
// and applies the Plus-specific cell writes on top of each plan.

import { prisma } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';
import { readWorkbookGrid } from '@pazarsync/spreadsheet';

import { ConflictError, NotFoundError } from '../lib/errors';
import { cellText } from '../lib/xlsx-grid-cells';
import { patchXlsxCells, type XlsxCellValue } from '../lib/xlsx-patch';
import { resolvePlusTariffLayout, type PlusTariffLayout } from './plus-commission-tariff-layout';
import {
  bundleForDownload,
  exportFileName,
  planExportFiles,
  XLSX_MIME,
  ZIP_MIME,
  type ExportFile,
  type ExportFilePlan,
  type PeriodSelection,
} from './tariff-export-commons';

// Re-export the shared download primitives so the export route can keep importing
// them from the vertical it belongs to (mirrors the product commission export).
export { bundleForDownload, XLSX_MIME, ZIP_MIME };

const SHEET_NAME = 'TyPlusÜrünleri';

// "İptal" cell value for a joined product — "Hayır" = "no, don't cancel".
const NOT_CANCELLED = 'Hayır';
// Fixed, self-describing download base name for this vertical — the window suffix
// ("-3-gunluk" …) is appended per file, the zip drops it.
const EXPORT_BASE_NAME = 'plus-komisyon-tarifesi';

// ─── Per-product row patch ───────────────────────────────────────────────────

/** One period's "Hesaplanan Komisyon (N Gün)" write-back target + the percent to write. */
interface CommissionCell {
  readonly col: number;
  readonly pct: string;
}

/** The cells one selected product writes into a single window file. */
interface PlusRowPatch {
  /** Chosen Plus sale price (number cell → "Plus Fiyat Seçimi"). */
  readonly plusPrice: string;
  /** "Tarife Seçimi" marker, "{N} Günlük Fiyat" (inline string). */
  readonly marker: string;
  /** One "Hesaplanan Komisyon" cell per period this file covers (may be empty). */
  readonly commissionCells: readonly CommissionCell[];
}

// ─── The per-item join the seller's opt-in defines ───────────────────────────

/** Per period (parallel to the layout's periods, in sort order): the seller's opt-in. */
interface PlusPeriodSelection {
  /** barcode → chosen Plus price (custom price, else the ceiling), `.toFixed(2)`. */
  readonly pricesByBarcode: ReadonlyMap<string, string>;
  /** barcode → this period's reduced Plus commission percent, verbatim (e.g. "15.4"). */
  readonly commissionByBarcode: ReadonlyMap<string, string>;
}

// ─── Byte-preserving patch of one file from a row map ────────────────────────

function patchSource(
  source: Buffer,
  grid: ReadonlyArray<ReadonlyArray<unknown>>,
  layout: PlusTariffLayout,
  rows: ReadonlyMap<string, PlusRowPatch>,
): Buffer {
  // barcode → the patched cells, keyed by the 1-based Excel row. Only columns that
  // exist in this file are written (a missing target is skipped).
  const rowPatches = new Map<number, Map<number, XlsxCellValue>>();
  for (let i = 1; i < grid.length; i += 1) {
    const barcode = cellText(grid[i] ?? [], layout.barcode);
    if (barcode === null) continue;
    const patch = rows.get(barcode);
    if (patch === undefined) continue;

    const cells = new Map<number, XlsxCellValue>();
    if (layout.plusPriceSelection >= 0) {
      cells.set(layout.plusPriceSelection, { kind: 'number', value: patch.plusPrice });
    }
    if (layout.tariffSelection >= 0) {
      cells.set(layout.tariffSelection, { kind: 'inlineStr', value: patch.marker });
    }
    for (const { col, pct } of patch.commissionCells) {
      cells.set(col, { kind: 'number', value: pct });
    }
    if (layout.cancelled >= 0) {
      cells.set(layout.cancelled, { kind: 'inlineStr', value: NOT_CANCELLED });
    }
    if (cells.size > 0) rowPatches.set(i + 1, cells);
  }
  return patchXlsxCells(source, rowPatches);
}

/**
 * Builds the per-barcode Plus patch for one plan. Price + marker come from the shared
 * plan; the commission cells are Plus-specific: one per period the file covers (its
 * `computedCommissionCol`, skipped when -1), each at that period's own reduced percent
 * for this barcode. A whole-week file therefore writes ONE price but a commission cell
 * per sub-period; a single window file writes just that period's.
 */
function buildPlanRows(
  plan: ExportFilePlan,
  layout: PlusTariffLayout,
  selections: ReadonlyArray<PlusPeriodSelection>,
): Map<string, PlusRowPatch> {
  const rows = new Map<string, PlusRowPatch>();
  for (const [barcode, { newPrice, selection }] of plan.rows) {
    const commissionCells: CommissionCell[] = [];
    for (const periodIndex of plan.periodIndices) {
      const col = layout.periods[periodIndex]?.computedCommissionCol ?? -1;
      if (col < 0) continue;
      const pct = selections[periodIndex]?.commissionByBarcode.get(barcode);
      if (pct === undefined) continue;
      commissionCells.push({ col, pct });
    }
    rows.set(barcode, { plusPrice: newPrice, marker: selection, commissionCells });
  }
  return rows;
}

// ─── Entry point ────────────────────────────────────────────────────────────

export interface ExportPlusTariffResult {
  /** Up to three window files (7-Gün / 3-Gün / 4-Gün), only the non-empty ones. */
  readonly files: ExportFile[];
}

/**
 * Produces the seller's re-uploadable Trendyol Plus file(s): the original upload with
 * the chosen Plus price + selection marker + reduced commission written for every
 * opted-in product. A split week yields up to three window files (7-Gün whole-week +
 * 3-Gün + 4-Gün), only the non-empty ones. Marks the tariff exported. Throws
 * `NotFoundError` if the tariff is not in this store, `ConflictError` if no source file
 * was kept or it is unreadable.
 */
export async function exportPlusTariff(
  orgId: string,
  storeId: string,
  tariffId: string,
): Promise<ExportPlusTariffResult> {
  let tariff;
  try {
    tariff = await prisma.plusCommissionTariff.findFirst({
      where: { id: tariffId, organizationId: orgId, storeId },
      select: {
        sourceFile: true,
        periods: {
          orderBy: { sortOrder: 'asc' },
          select: {
            dayCount: true,
            items: {
              select: {
                barcode: true,
                plusSelected: true,
                customPrice: true,
                plusPriceUpperLimit: true,
                plusCommissionPct: true,
              },
            },
          },
        },
      },
    });
  } catch (err) {
    mapPrismaError(err);
  }

  if (tariff === null) {
    throw new NotFoundError('PlusCommissionTariff', tariffId);
  }
  if (tariff.sourceFile === null) {
    throw new ConflictError('Plus tariff has no stored source file to export');
  }

  // Per period (in sort order), the seller's opt-in: for every SELECTED product, the
  // chosen Plus price (custom price, else the ceiling) and that period's reduced Plus
  // commission percent. `pricesByBarcode` drives the shared bucketing; the commissions
  // are joined back per file so the whole-week bucket writes both periods' percents.
  const periodData = tariff.periods.map((period): PlusPeriodSelection => {
    const pricesByBarcode = new Map<string, string>();
    const commissionByBarcode = new Map<string, string>();
    for (const item of period.items) {
      if (!item.plusSelected) continue;
      const price = (item.customPrice ?? item.plusPriceUpperLimit).toFixed(2);
      pricesByBarcode.set(item.barcode, price);
      commissionByBarcode.set(item.barcode, item.plusCommissionPct.toString());
    }
    return { pricesByBarcode, commissionByBarcode };
  });

  const periodSelections: PeriodSelection[] = tariff.periods.map((period, i) => ({
    dayCount: period.dayCount,
    pricesByBarcode: periodData[i]?.pricesByBarcode ?? new Map(),
  }));

  const plans = planExportFiles(periodSelections);

  const source = Buffer.from(tariff.sourceFile);
  const grid = await readWorkbookGrid(source, { sheetName: SHEET_NAME });
  const layout = resolvePlusTariffLayout(grid[0] ?? []);
  if (layout === null) {
    throw new ConflictError('Stored Plus tariff file is not a recognizable Trendyol export');
  }
  // The seller's opt-in is written into "Plus Fiyat Seçimi" / "Tarife Seçimi". If the
  // stored file carries NEITHER, the export cannot represent the opt-in — fail loudly
  // rather than silently hand back an unpatched, misleading file.
  if (layout.plusPriceSelection < 0 && layout.tariffSelection < 0) {
    throw new ConflictError('Stored Plus tariff file has no opt-in columns to write back');
  }

  const files: ExportFile[] =
    plans.length > 0
      ? plans.map((plan) => ({
          filename: exportFileName(EXPORT_BASE_NAME, plan.suffix),
          file: patchSource(source, grid, layout, buildPlanRows(plan, layout, periodData)),
        }))
      : // No product opted in → hand back the source verbatim (one file), so a
        // re-download never 409s (mirrors the product tariff's fallback).
        [
          {
            filename: exportFileName(EXPORT_BASE_NAME, null),
            file: patchSource(source, grid, layout, new Map()),
          },
        ];

  try {
    await prisma.plusCommissionTariff.update({
      where: { id: tariffId },
      data: { exportedAt: new Date() },
    });
  } catch (err) {
    mapPrismaError(err);
  }

  return { files };
}
