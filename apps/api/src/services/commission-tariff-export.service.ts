// Export service for the saved Commission Tariffs feature.
//
// The seller re-uploads the result to Trendyol VERBATIM, so we patch the seller's
// chosen price + tariff selection into Trendyol's EXACT original file (kept at
// import as `sourceFile`) rather than regenerating. Only two cells per selected
// product change: "YENİ TSF (FİYAT GÜNCELLE)" ← the chosen band price, and
// "Tarife Seçimi" ← "{N} Günlük Fiyat" (matching Trendyol's own filled exports).
// The byte-preserving cell patching lives in the shared `lib/xlsx-patch` helper.
//
// The per-sub-period bucketing (up to three window files: 7-Gün whole-week + 3-Gün +
// 4-Gün) and the single-download bundling are vertical-agnostic — they live in
// `tariff-export-commons`. This service only supplies the per-period barcode→price
// maps and applies the two commission-specific cell writes on top of the plan.

import { Decimal } from 'decimal.js';

import { prisma } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';
import { readWorkbookGrid } from '@pazarsync/spreadsheet';

import { ConflictError, NotFoundError } from '../lib/errors';
import { cellText } from '../lib/xlsx-grid-cells';
import { patchXlsxCells, type XlsxCellValue } from '../lib/xlsx-patch';
import { bandPrice } from './commission-tariff-compute.service';
import { resolveTariffLayout, type TariffLayout } from './commission-tariff-layout';
import { parseStoredBands } from './commission-tariff.types';
import {
  bundleForDownload,
  exportFileName,
  planExportFiles,
  XLSX_MIME,
  ZIP_MIME,
  type ExportFile,
  type PeriodSelection,
  type RowPatch,
} from './tariff-export-commons';

// Re-export the shared download primitives so the export route (and any future caller)
// can keep importing them from the vertical it belongs to.
export { bundleForDownload, XLSX_MIME, ZIP_MIME };

const SHEET_NAME = 'KomisyonTarifeleriÜrünleri';
// Fixed, self-describing download base name for this vertical — the window suffix
// ("-3-gunluk" …) is appended per file, the zip drops it. Not derived from the
// uploaded file's name (which was Trendyol's opaque export name).
const EXPORT_BASE_NAME = 'urun-komisyon-tarifesi';

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

export interface ExportTariffResult {
  /** Up to three window files (7-Gün / 3-Gün / 4-Gün), only the non-empty ones. */
  readonly files: ExportFile[];
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
          filename: exportFileName(EXPORT_BASE_NAME, plan.suffix),
          file: patchSource(source, grid, layout, plan.rows),
        }))
      : // No product selected in any period → hand back the source verbatim (one file),
        // matching the pre-per-period behavior so a re-download never 409s.
        [
          {
            filename: exportFileName(EXPORT_BASE_NAME, null),
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
