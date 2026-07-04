// Export service for the saved Commission Tariffs feature.
//
// The seller re-uploads the result to Trendyol VERBATIM, so we patch the seller's
// chosen price + tariff selection into Trendyol's EXACT original file (kept at
// import as `sourceFile`) rather than regenerating. Only two cells per selected
// product change: "YENİ TSF (FİYAT GÜNCELLE)" ← the chosen band price, and
// "Tarife Seçimi" ← "{N} Günlük Fiyat" (matching Trendyol's own filled exports,
// e.g. the melontik sample). The byte-preserving cell patching lives in the
// shared `lib/xlsx-patch` helper; here we only decide WHICH cells get WHICH value.

import { Decimal } from 'decimal.js';

import { prisma } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';
import { readWorkbookGrid } from '@pazarsync/spreadsheet';

import { ConflictError, NotFoundError } from '../lib/errors';
import { cellText } from '../lib/xlsx-grid-cells';
import { patchXlsxCells, type XlsxCellValue } from '../lib/xlsx-patch';
import { bandPrice } from './commission-tariff-compute.service';
import { resolveTariffLayout } from './commission-tariff-layout';
import { parseStoredBands } from './commission-tariff.types';

const SHEET_NAME = 'KomisyonTarifeleriÜrünleri';

// ─── Per-product patch (the two cells the seller's selection writes) ─────────

interface RowPatch {
  newPrice: string;
  selection: string;
}

// ─── Entry point ────────────────────────────────────────────────────────────

export interface ExportTariffResult {
  filename: string;
  file: Buffer;
}

/**
 * Produces the seller's re-uploadable Trendyol file: the original upload with the
 * chosen price written into "YENİ TSF" and "{N} Günlük Fiyat" into "Tarife
 * Seçimi" for every product that has a selection. Marks the tariff exported.
 * Throws `NotFoundError` if the tariff is not in this store, `ConflictError` if
 * no source file was kept (older tariff) or the stored file is unreadable.
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
        name: true,
        sourceFile: true,
        sourceFilename: true,
        periods: {
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

  // Per-barcode patch from the seller's selections. The UI selects one band per
  // product; if multiple periods carry a selection, the last one wins.
  const patchByBarcode = new Map<string, RowPatch>();
  for (const period of tariff.periods) {
    for (const item of period.items) {
      if (item.selectedBand === null) continue;
      const band = parseStoredBands(item.bands).find((b) => b.key === item.selectedBand);
      // Selecting a band means "set my price to the price shown in that column" — the band
      // boundary the seller sees (upper limit for bands 2-4, lower limit for the open-topped
      // band 1), via the shared bandPrice() so the export matches the profit shown on screen.
      const chosenBandPrice = band
        ? bandPrice(band, new Decimal(item.currentPrice.toString())).toFixed(2)
        : item.currentPrice.toFixed(2);
      const newPrice = item.customPrice !== null ? item.customPrice.toFixed(2) : chosenBandPrice;
      const selection =
        period.dayCount !== null ? `${period.dayCount} Günlük Fiyat` : 'Günlük Fiyat';
      patchByBarcode.set(item.barcode, { newPrice, selection });
    }
  }

  const source = Buffer.from(tariff.sourceFile);
  const grid = await readWorkbookGrid(source, { sheetName: SHEET_NAME });
  const layout = resolveTariffLayout(grid[0] ?? []);
  if (layout === null) {
    throw new ConflictError('Stored tariff file is not a recognizable Trendyol export');
  }

  // Map each data row's barcode to its two patched cells, keyed by the 1-based
  // Excel row: "YENİ TSF" (numeric) + "Tarife Seçimi" (inline string).
  const rowPatches = new Map<number, Map<number, XlsxCellValue>>();
  for (let i = 1; i < grid.length; i += 1) {
    const barcode = cellText(grid[i] ?? [], layout.fixed.barcode);
    if (barcode === null) continue;
    const patch = patchByBarcode.get(barcode);
    if (patch !== undefined) {
      rowPatches.set(
        i + 1,
        new Map<number, XlsxCellValue>([
          [layout.newTsf, { kind: 'number', value: patch.newPrice }],
          [layout.tariffSelection, { kind: 'inlineStr', value: patch.selection }],
        ]),
      );
    }
  }

  const file = patchXlsxCells(source, rowPatches);

  try {
    await prisma.commissionTariff.update({
      where: { id: tariffId },
      data: { exportedAt: new Date() },
    });
  } catch (err) {
    mapPrismaError(err);
  }

  return { filename: tariff.sourceFilename ?? `${tariff.name}.xlsx`, file };
}
