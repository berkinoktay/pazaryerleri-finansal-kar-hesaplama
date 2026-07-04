// Export service for the saved Commission Tariffs feature.
//
// The seller re-uploads the result to Trendyol VERBATIM, so we patch the seller's
// chosen price + tariff selection into Trendyol's EXACT original file (kept at
// import as `sourceFile`) rather than regenerating. Only two cells per selected
// product change: "YENİ TSF (FİYAT GÜNCELLE)" ← the chosen band price, and
// "Tarife Seçimi" ← "{N} Günlük Fiyat" (matching Trendyol's own filled exports).
// The byte-preserving cell patching lives in the shared `lib/xlsx-patch` helper.
//
// Multi-period export (3-Gün / 4-Gün split weeks): the seller re-uploads to Trendyol
// PER WINDOW, so we bucket selections into up to THREE files, each emitted only if it
// has a product:
//   • "7 Günlük Fiyat" file — products the seller marked whole-week (same price in
//     BOTH sub-periods): one row per product, applied to the whole week.
//   • "3 Günlük Fiyat" file — products with a 3-Gün-specific price.
//   • "4 Günlük Fiyat" file — products with a 4-Gün-specific price.
// A product priced DIFFERENTLY across the sub-periods lands in both the 3- and 4-Gün
// files; a whole-week product lands only in the 7-Gün file. Every file is named
// "urun-komisyon-tarifesi-{dayCount}-gunluk.xlsx" (the zip drops the window suffix).

import { Decimal } from 'decimal.js';
import { zipSync } from 'fflate';

import { prisma } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';
import { readWorkbookGrid } from '@pazarsync/spreadsheet';

import { ConflictError, NotFoundError } from '../lib/errors';
import { cellText } from '../lib/xlsx-grid-cells';
import { patchXlsxCells, type XlsxCellValue } from '../lib/xlsx-patch';
import { bandPrice } from './commission-tariff-compute.service';
import { resolveTariffLayout, type TariffLayout } from './commission-tariff-layout';
import { parseStoredBands } from './commission-tariff.types';

const SHEET_NAME = 'KomisyonTarifeleriÜrünleri';
// A Trendyol tariff spans a week; the label falls back to this when a period header
// lacked its "(N Gün)" count.
const DEFAULT_WEEK_DAYS = 7;
// Fixed, self-describing download base name for this vertical — the window suffix
// ("-3-gunluk" …) is appended per file, the zip drops it. Not derived from the
// uploaded file's name (which was Trendyol's opaque export name).
const EXPORT_BASE_NAME = 'urun-komisyon-tarifesi';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const ZIP_MIME = 'application/zip';

// ─── Per-product row patch (the two cells the seller's selection writes) ──────

interface RowPatch {
  readonly newPrice: string;
  readonly selection: string;
}

// ─── The pure grouping: which product goes into which file, as what ──────────

/** One sub-period's chosen prices, keyed by barcode (only products with a selection). */
export interface PeriodSelection {
  /** The N from "Tarih aralığı (N Gün)" (e.g. 3 or 4); null when the header lacked it. */
  readonly dayCount: number | null;
  /** barcode → chosen price (already `.toFixed(2)`). */
  readonly pricesByBarcode: ReadonlyMap<string, string>;
}

/** One output Excel: `suffix` is the "{dayCount}-gunluk" window tag (null only for the zero-selection fallback). */
export interface ExportFilePlan {
  readonly suffix: string | null;
  readonly rows: ReadonlyMap<string, RowPatch>;
}

/**
 * Buckets per-sub-period selections into up to three window files (7-Gün / 3-Gün /
 * 4-Gün), each emitted only when it has a product. A product priced the SAME in every
 * sub-period is whole-week → the `"{week} Günlük Fiyat"` file; a period-specific price
 * goes in that period's `"{dayCount} Günlük Fiyat"` file (so a 3-Gün≠4-Gün product
 * lands in BOTH). A single-period (full-week) tariff yields one day-suffixed file.
 * `pricesByBarcode` holds only SELECTED products, so an unselected bucket yields no file.
 */
export function planExportFiles(periods: ReadonlyArray<PeriodSelection>): ExportFilePlan[] {
  if (periods.length === 0) return [];
  // The whole-week label = the sum of the sub-period day counts (3 + 4 = 7); falls
  // back to a Trendyol tariff week.
  const weekDayCount = periods.reduce((sum, p) => sum + (p.dayCount ?? 0), 0) || DEFAULT_WEEK_DAYS;

  // Full-week (single-period) tariff → one file, every product "{dayCount} Günlük Fiyat".
  // Still carries the "{dayCount}-gunluk" filename suffix so a lone (non-zip) download
  // tells the seller which window it is.
  if (periods.length === 1) {
    const only = periods[0];
    if (only === undefined || only.pricesByBarcode.size === 0) return [];
    const dayCount = only.dayCount ?? weekDayCount;
    const rows = new Map<string, RowPatch>();
    for (const [barcode, price] of only.pricesByBarcode) {
      rows.set(barcode, { newPrice: price, selection: `${dayCount} Günlük Fiyat` });
    }
    return [{ suffix: `${dayCount}-gunluk`, rows }];
  }

  const wholeWeek = new Map<string, RowPatch>();
  const perPeriod = periods.map(() => new Map<string, RowPatch>());

  const barcodes = new Set<string>();
  for (const period of periods) for (const bc of period.pricesByBarcode.keys()) barcodes.add(bc);

  for (const barcode of barcodes) {
    const prices = periods.map((p) => p.pricesByBarcode.get(barcode) ?? null);
    const chosen = prices.filter((p): p is string => p !== null);
    const first = chosen[0];
    if (first === undefined) continue;

    // Selected in every sub-period at the same price → one whole-week ("7 Günlük") row.
    if (chosen.length === periods.length && chosen.every((p) => p === first)) {
      wholeWeek.set(barcode, { newPrice: first, selection: `${weekDayCount} Günlük Fiyat` });
      continue;
    }
    // Otherwise each selected period's price goes in its own window file.
    prices.forEach((price, i) => {
      if (price === null) return;
      const dayCount = periods[i]?.dayCount ?? weekDayCount;
      perPeriod[i]?.set(barcode, { newPrice: price, selection: `${dayCount} Günlük Fiyat` });
    });
  }

  const files: ExportFilePlan[] = [];
  periods.forEach((period, i) => {
    const rows = perPeriod[i];
    if (rows === undefined || rows.size === 0) return;
    files.push({ suffix: `${period.dayCount ?? weekDayCount}-gunluk`, rows });
  });
  if (wholeWeek.size > 0) files.push({ suffix: `${weekDayCount}-gunluk`, rows: wholeWeek });
  return files;
}

// ─── Byte-preserving patch of one file from a row map ────────────────────────

function patchSource(
  source: Buffer,
  grid: ReadonlyArray<ReadonlyArray<unknown>>,
  layout: TariffLayout,
  rows: ReadonlyMap<string, RowPatch>,
): Buffer {
  // barcode → the two patched cells, keyed by the 1-based Excel row.
  const rowPatches = new Map<number, Map<number, XlsxCellValue>>();
  for (let i = 1; i < grid.length; i += 1) {
    const barcode = cellText(grid[i] ?? [], layout.fixed.barcode);
    if (barcode === null) continue;
    const patch = rows.get(barcode);
    if (patch === undefined) continue;
    rowPatches.set(
      i + 1,
      new Map<number, XlsxCellValue>([
        [layout.newTsf, { kind: 'number', value: patch.newPrice }],
        [layout.tariffSelection, { kind: 'inlineStr', value: patch.selection }],
      ]),
    );
  }
  return patchXlsxCells(source, rowPatches);
}

// ─── Entry point ────────────────────────────────────────────────────────────

export interface ExportFile {
  readonly filename: string;
  readonly file: Buffer;
}

export interface ExportTariffResult {
  /** Up to three window files (7-Gün / 3-Gün / 4-Gün), only the non-empty ones. */
  readonly files: ExportFile[];
}

export interface DownloadBundle {
  readonly body: Buffer;
  readonly filename: string;
  readonly contentType: string;
}

/**
 * Packages the per-period export files into ONE HTTP download: a lone file streams as
 * its `.xlsx`; a split week's two window files bundle into a single `.zip` so one
 * "Dışa aktar" click delivers both. Throws `ConflictError` when there are no files (a
 * source-less / empty tariff — already guarded upstream).
 */
export function bundleForDownload(files: ReadonlyArray<ExportFile>): DownloadBundle {
  const [first, ...rest] = files;
  if (first === undefined) {
    throw new ConflictError('Tariff produced no export files');
  }
  if (rest.length === 0) {
    return { body: first.file, filename: first.filename, contentType: XLSX_MIME };
  }
  const zippable: Record<string, Uint8Array> = {};
  for (const f of files) zippable[f.filename] = new Uint8Array(f.file);
  return {
    body: Buffer.from(zipSync(zippable)),
    // Name the zip after the tariff, not the first window file: strip the trailing
    // "-{N}-gunluk" window suffix so a split week downloads as "{base}.zip".
    filename: first.filename.replace(/(?:-\d+-gunluk)?\.xlsx$/i, '.zip'),
    contentType: ZIP_MIME,
  };
}

/**
 * Produces the seller's re-uploadable Trendyol file(s): the original upload with the
 * chosen price written into "YENİ TSF" and "{N} Günlük Fiyat" into "Tarife Seçimi"
 * per selected product. A split week yields up to three window files (7-Gün whole-week
 * + 3-Gün + 4-Gün), only the non-empty ones. Marks the tariff exported. Throws
 * `NotFoundError` if the tariff is not in this store, `ConflictError` if no source file
 * was kept or it is unreadable.
 */
export async function exportTariff(
  orgId: string,
  storeId: string,
  tariffId: string,
): Promise<ExportTariffResult> {
  let tariff;
  try {
    tariff = await prisma.commissionTariff.findFirst({
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
                selectedBand: true,
                customPrice: true,
                currentPrice: true,
                bands: true,
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
    throw new NotFoundError('CommissionTariff', tariffId);
  }
  if (tariff.sourceFile === null) {
    throw new ConflictError('Tariff has no stored source file to export');
  }

  // Per period, the chosen price of every SELECTED product (selectedBand set). The
  // price is the band boundary the seller sees (via bandPrice), or a custom override.
  const periodSelections: PeriodSelection[] = tariff.periods.map((period) => {
    const pricesByBarcode = new Map<string, string>();
    for (const item of period.items) {
      if (item.selectedBand === null) continue;
      const band = parseStoredBands(item.bands).find((b) => b.key === item.selectedBand);
      const chosenBandPrice = band
        ? bandPrice(band, new Decimal(item.currentPrice.toString())).toFixed(2)
        : item.currentPrice.toFixed(2);
      pricesByBarcode.set(
        item.barcode,
        item.customPrice !== null ? item.customPrice.toFixed(2) : chosenBandPrice,
      );
    }
    return { dayCount: period.dayCount, pricesByBarcode };
  });

  const plans = planExportFiles(periodSelections);

  const source = Buffer.from(tariff.sourceFile);
  const grid = await readWorkbookGrid(source, { sheetName: SHEET_NAME });
  const layout = resolveTariffLayout(grid[0] ?? []);
  if (layout === null) {
    throw new ConflictError('Stored tariff file is not a recognizable Trendyol export');
  }

  const files: ExportFile[] =
    plans.length > 0
      ? plans.map((plan) => ({
          filename:
            plan.suffix === null
              ? `${EXPORT_BASE_NAME}.xlsx`
              : `${EXPORT_BASE_NAME}-${plan.suffix}.xlsx`,
          file: patchSource(source, grid, layout, plan.rows),
        }))
      : // No product selected in any period → hand back the source verbatim (one file),
        // matching the pre-per-period behavior so a re-download never 409s.
        [
          {
            filename: `${EXPORT_BASE_NAME}.xlsx`,
            file: patchSource(source, grid, layout, new Map()),
          },
        ];

  try {
    await prisma.commissionTariff.update({
      where: { id: tariffId },
      data: { exportedAt: new Date() },
    });
  } catch (err) {
    mapPrismaError(err);
  }

  return { files };
}
