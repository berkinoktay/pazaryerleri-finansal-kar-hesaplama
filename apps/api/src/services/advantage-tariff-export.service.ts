// Export service for the Advantage Product Labels feature.
//
// Like the other tariff exports, the seller re-uploads the result to Trendyol
// VERBATIM, so we patch their chosen new price into the EXACT original file (kept
// at import as `sourceFile`) via the shared byte-preserving `patchXlsxCells`
// helper. Every other cell stays byte-for-byte intact.
//
// For each product the seller picked a tier, ONE cell is written for v1:
//   • "YENİ TSF (FİYAT GÜNCELLE)" ← the chosen new price (custom, else the tier upper)
//
// The "Tarife Sonuna Kadar Uygula" (and any external) columns are deliberately NOT
// written yet — the exact cell contract Trendyol requires for re-upload acceptance
// is pending a live round-trip validation by Berkin (see the advantage-labels
// design §11, mirroring how the commission/plus markers were confirmed against a
// real filled file).

import { Decimal } from 'decimal.js';

import { Prisma, prisma } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';
import { readWorkbookGrid, SpreadsheetFileError, type SheetData } from '@pazarsync/spreadsheet';

import { ConflictError, NotFoundError } from '../lib/errors';
import { cellText } from '../lib/xlsx-grid-cells';
import { patchXlsxCells, type XlsxCellValue } from '../lib/xlsx-patch';
import { resolveAdvantageTariffLayout } from './advantage-tariff-layout';
import { parseStarTiers } from './advantage-tariff.types';

const SHEET_NAME = 'YıldızlıÜrünEtiketleri';

export interface ExportAdvantageTariffResult {
  filename: string;
  file: Buffer;
}

/** The item fields the export needs to resolve a barcode's new price. */
export interface AdvantageExportItem {
  readonly selectedTier: string | null;
  readonly customPrice: Prisma.Decimal | null;
  readonly starTiers: Prisma.JsonValue;
}

/**
 * The seller's chosen new price for one Advantage item, or null when the row is not
 * joined. A row is joined when it carries a CUSTOM price OR a selected tier: the two
 * are mutually exclusive in the UI, but a confirmed custom price is persisted with
 * `selected_tier = NULL` (only `custom_price` set), so gating the "is joined" test on
 * `selectedTier` alone silently dropped every custom-only row from the export. Price =
 * the custom override, else the chosen tier's upper threshold (the highest price still
 * earning that badge). Mirrors the commission export's `custom ?? bandPrice` — checked
 * custom-FIRST so a custom-only row (tier null) still resolves.
 */
export function resolveAdvantageExportPrice(item: AdvantageExportItem): string | null {
  if (item.customPrice !== null) return item.customPrice.toFixed(2);
  if (item.selectedTier === null) return null;
  const tier = parseStarTiers(item.starTiers).find((t) => t.key === item.selectedTier);
  return tier !== undefined ? new Decimal(tier.upperLimit).toFixed(2) : null;
}

/**
 * Produces the seller's re-uploadable Trendyol file: the original upload with the
 * chosen new price written for every product that has a selected tier. Marks the
 * tariff exported. Throws `NotFoundError` if the tariff is not in this store,
 * `ConflictError` if no source file was kept, it is unreadable, or it has no
 * "YENİ TSF" column to write back.
 */
export async function exportAdvantageTariff(
  orgId: string,
  storeId: string,
  tariffId: string,
): Promise<ExportAdvantageTariffResult> {
  let tariff;
  try {
    tariff = await prisma.advantageTariff.findFirst({
      where: { id: tariffId, organizationId: orgId, storeId },
      select: {
        name: true,
        sourceFile: true,
        sourceFilename: true,
        items: {
          select: {
            barcode: true,
            selectedTier: true,
            customPrice: true,
            starTiers: true,
          },
        },
      },
    });
  } catch (err) {
    mapPrismaError(err);
  }

  if (tariff === null) {
    throw new NotFoundError('AdvantageTariff', tariffId);
  }
  if (tariff.sourceFile === null) {
    throw new ConflictError('Advantage tariff has no stored source file to export');
  }

  // Per-barcode new price: the custom override, else the chosen tier's upper threshold
  // (the highest price still earning that badge). A custom-only row (tier null, custom
  // set) resolves via `resolveAdvantageExportPrice` too — see its doc for the fix.
  const priceByBarcode = new Map<string, string>();
  for (const item of tariff.items) {
    const priceStr = resolveAdvantageExportPrice(item);
    if (priceStr !== null) priceByBarcode.set(item.barcode, priceStr);
  }

  const source = Buffer.from(tariff.sourceFile);
  let grid: SheetData;
  try {
    grid = await readWorkbookGrid(source, { sheetName: SHEET_NAME });
  } catch (err) {
    // The stored source parsed cleanly at import; if the bytes no longer read, that is
    // a conflict with the stored server state (409), not our bug (500) — the same
    // contract as the recognizable-format / missing-column guards just below.
    if (err instanceof SpreadsheetFileError) {
      throw new ConflictError('Stored advantage tariff file could not be read');
    }
    throw err;
  }
  const layout = resolveAdvantageTariffLayout(grid[0] ?? []);
  if (layout === null) {
    throw new ConflictError('Stored advantage tariff file is not a recognizable Trendyol export');
  }
  if (layout.newTsf < 0) {
    throw new ConflictError('Stored advantage tariff file has no "YENİ TSF" column to write back');
  }

  // Map each data row's barcode → the new-price cell, keyed by the 1-based Excel row.
  const rowPatches = new Map<number, Map<number, XlsxCellValue>>();
  for (let i = 1; i < grid.length; i += 1) {
    const barcode = cellText(grid[i] ?? [], layout.barcode);
    if (barcode === null) continue;
    const price = priceByBarcode.get(barcode);
    if (price === undefined) continue;

    const cells = new Map<number, XlsxCellValue>();
    cells.set(layout.newTsf, { kind: 'number', value: price });
    rowPatches.set(i + 1, cells);
  }

  const file = patchXlsxCells(source, rowPatches);

  try {
    await prisma.advantageTariff.update({
      where: { id: tariffId },
      data: { exportedAt: new Date() },
    });
  } catch (err) {
    mapPrismaError(err);
  }

  return { filename: tariff.sourceFilename ?? `${tariff.name}.xlsx`, file };
}
