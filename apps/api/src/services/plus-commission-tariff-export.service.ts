// Export service for the saved Plus Commission Tariffs feature.
//
// Like the product tariff export, the seller re-uploads the result to Trendyol
// VERBATIM, so we patch their opt-in into the EXACT original file (kept at import
// as `sourceFile`) via the shared byte-preserving `patchXlsxCells` helper. Every
// other cell — including the raw file's uncached-formula helper columns — stays
// byte-for-byte intact.
//
// The exact filled-cell format was confirmed from a real filled Trendyol Plus
// export (the competitor "melontik" sample, mirroring how the product tariff's
// "{N} Günlük Fiyat" marker was confirmed). For every product the seller opted
// into Plus, four cells are written:
//   • "Plus Fiyat Seçimi"          ← the chosen Plus price (custom, else ceiling)
//   • "Tarife Seçimi"              ← "{dayCount} Günlük Fiyat" (e.g. "7 Günlük Fiyat")
//   • "Hesaplanan Komisyon (7 Gün)"← the reduced Plus commission percent
//   • "İptal"                      ← "Hayır" (confirm the offer, do not cancel)

import { prisma } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';
import { readWorkbookGrid } from '@pazarsync/spreadsheet';

import { ConflictError, NotFoundError } from '../lib/errors';
import { cellText } from '../lib/xlsx-grid-cells';
import { patchXlsxCells, type XlsxCellValue } from '../lib/xlsx-patch';
import { resolvePlusTariffLayout } from './plus-commission-tariff-layout';

const SHEET_NAME = 'TyPlusÜrünleri';

// "İptal" cell value for a joined product — "Hayır" = "no, don't cancel".
const NOT_CANCELLED = 'Hayır';

interface RowPatch {
  /** Chosen Plus sale price (number cell). */
  plusPrice: string;
  /** "Tarife Seçimi" marker, "{dayCount} Günlük Fiyat" (inline string). */
  marker: string;
  /** Reduced Plus commission percent (number cell). */
  commissionPct: string;
}

export interface ExportPlusTariffResult {
  filename: string;
  file: Buffer;
}

/**
 * Produces the seller's re-uploadable Trendyol Plus file: the original upload with
 * the chosen Plus price + selection marker written for every opted-in product.
 * Marks the tariff exported. Throws `NotFoundError` if the tariff is not in this
 * store, `ConflictError` if no source file was kept or it is unreadable.
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
        name: true,
        sourceFile: true,
        sourceFilename: true,
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

  // Per-barcode patch from the seller's opt-ins: the chosen Plus price (custom
  // price, else the ceiling), the "{N} Günlük Fiyat" marker, and the Plus
  // commission the seller earns.
  const marker = `${tariff.dayCount ?? 7} Günlük Fiyat`;
  const patchByBarcode = new Map<string, RowPatch>();
  for (const item of tariff.items) {
    if (!item.plusSelected) continue;
    const plusPrice = (item.customPrice ?? item.plusPriceUpperLimit).toFixed(2);
    patchByBarcode.set(item.barcode, {
      plusPrice,
      marker,
      commissionPct: item.plusCommissionPct.toString(),
    });
  }

  const source = Buffer.from(tariff.sourceFile);
  const grid = await readWorkbookGrid(source, { sheetName: SHEET_NAME });
  const layout = resolvePlusTariffLayout(grid[0] ?? []);
  if (layout === null) {
    throw new ConflictError('Stored Plus tariff file is not a recognizable Trendyol export');
  }
  // The seller's opt-in is written into "Plus Fiyat Seçimi" / "Tarife Seçimi".
  // If the stored file carries NEITHER, the export cannot represent the opt-in —
  // fail loudly rather than silently hand back an unpatched, misleading file.
  if (layout.plusPriceSelection < 0 && layout.tariffSelection < 0) {
    throw new ConflictError('Stored Plus tariff file has no opt-in columns to write back');
  }

  // Map each data row's barcode to its patched cells, keyed by the 1-based Excel
  // row. Only patch columns that exist in this file (a missing target is skipped).
  const rowPatches = new Map<number, Map<number, XlsxCellValue>>();
  for (let i = 1; i < grid.length; i += 1) {
    const barcode = cellText(grid[i] ?? [], layout.barcode);
    if (barcode === null) continue;
    const patch = patchByBarcode.get(barcode);
    if (patch === undefined) continue;

    const cells = new Map<number, XlsxCellValue>();
    if (layout.plusPriceSelection >= 0) {
      cells.set(layout.plusPriceSelection, { kind: 'number', value: patch.plusPrice });
    }
    if (layout.tariffSelection >= 0) {
      cells.set(layout.tariffSelection, { kind: 'inlineStr', value: patch.marker });
    }
    if (layout.computedCommission >= 0) {
      cells.set(layout.computedCommission, { kind: 'number', value: patch.commissionPct });
    }
    if (layout.cancelled >= 0) {
      cells.set(layout.cancelled, { kind: 'inlineStr', value: NOT_CANCELLED });
    }
    if (cells.size > 0) rowPatches.set(i + 1, cells);
  }

  const file = patchXlsxCells(source, rowPatches);

  try {
    await prisma.plusCommissionTariff.update({
      where: { id: tariffId },
      data: { exportedAt: new Date() },
    });
  } catch (err) {
    mapPrismaError(err);
  }

  return { filename: tariff.sourceFilename ?? `${tariff.name}.xlsx`, file };
}
