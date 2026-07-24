// Export service for the İndirimler (Promosyon > İndirimler) feature.
//
// Like the other campaign-tariff exports, the seller re-uploads the result to Trendyol
// VERBATIM, so we patch their choices into the EXACT original file (kept at import as
// `sourceFile`) via the shared byte-preserving `patchXlsxCells` helper. Every other cell
// stays byte-for-byte intact.
//
// The ONE column this vertical writes is the participation column ("Kampayaya Dahil
// Edilsin Mi?"), and ONLY cells that DEVIATE from the source are patched: an included
// row whose source cell is not "Evet" gets "Evet"; an excluded row whose source cell IS
// "Evet" gets "Hayır" (the seller may have pre-marked the row in Trendyol and we dropped
// it from the selection). A row whose stored choice already matches the file is left
// entirely untouched, so a list with NO deviations produces an empty patch map and
// streams back byte-for-byte verbatim.
//
// Row alignment mirrors the import: the sortOrder-ordered items are zipped against the
// file's imported (non-skipped) data rows in order, with a barcode defensive guard so a
// predicate drift skips rather than writing into the wrong product's row.

import { prisma } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';
import { readWorkbookGrid, SpreadsheetFileError, type SheetData } from '@pazarsync/spreadsheet';

import { ConflictError, NotFoundError } from '../lib/errors';
import { cellCurrencyDecimalString, cellText } from '../lib/xlsx-grid-cells';
import { patchXlsxCells, type XlsxCellValue } from '../lib/xlsx-patch';
import {
  DISCOUNT_INCLUDED_NO,
  DISCOUNT_INCLUDED_YES,
  DISCOUNT_SHEET_NAME,
  resolveDiscountListLayout,
  type DiscountListLayout,
} from './discount-list-layout';

// Fallback output name when the list kept no original filename.
const DISCOUNT_EXPORT_FILENAME = 'indirimler.xlsx';

export interface ExportDiscountListResult {
  filename: string;
  file: Buffer;
}

/**
 * True when the import kept an item for this data row (so it must consume one item when
 * zipping). Mirrors `discount-list-import`'s `parseRow` skip rules: a barcode + a
 * currency-parsable current price. Kept in sync with that contract.
 */
function isImportedDiscountRow(row: readonly unknown[], layout: DiscountListLayout): boolean {
  return (
    cellText(row, layout.barcode) !== null &&
    cellCurrencyDecimalString(row, layout.currentPrice) !== null
  );
}

/**
 * Produces the seller's re-uploadable Trendyol file: the original upload with each row's
 * participation written into "Kampayaya Dahil Edilsin Mi?" — but ONLY where the stored
 * choice deviates from the source cell (included → "Evet", excluded → "Hayır"). Every
 * other cell is byte-for-byte unchanged; a list with no deviations streams back verbatim.
 * Marks the list exported. Throws `NotFoundError` when the list is not in this store,
 * `ConflictError` if no source file was kept, it is unreadable, or it is not a
 * recognizable İndirimler export.
 */
export async function exportDiscountList(
  orgId: string,
  storeId: string,
  listId: string,
): Promise<ExportDiscountListResult> {
  let list;
  try {
    list = await prisma.discountList.findFirst({
      where: { id: listId, organizationId: orgId, storeId },
      select: {
        sourceFile: true,
        sourceFilename: true,
        items: {
          orderBy: { sortOrder: 'asc' },
          select: { barcode: true, included: true },
        },
      },
    });
  } catch (err) {
    mapPrismaError(err);
  }

  if (list === null) {
    throw new NotFoundError('DiscountList', listId);
  }
  if (list.sourceFile === null) {
    throw new ConflictError('Discount list has no stored source file to export');
  }

  const source = Buffer.from(list.sourceFile);
  let grid: SheetData;
  try {
    grid = await readWorkbookGrid(source, { sheetName: DISCOUNT_SHEET_NAME });
  } catch (err) {
    // The stored source parsed cleanly at import; if the bytes no longer read, that is a
    // conflict with the stored server state (409), not our bug (500) — the same contract
    // as the recognizable-format guard just below.
    if (err instanceof SpreadsheetFileError) {
      throw new ConflictError('Stored discount file could not be read');
    }
    throw err;
  }
  const layout = resolveDiscountListLayout(grid[0] ?? []);
  if (layout === null) {
    throw new ConflictError('Stored discount file is not a recognizable Trendyol export');
  }

  // Zip the sortOrder-ordered items with the file's imported (non-skipped) data rows in
  // order: item[k] is the k-th kept row. Only cells whose stored choice DEVIATES from the
  // source participation cell are patched, so a list with no deviations yields an empty
  // patch map and the source bytes stream back untouched. Keyed by the 1-based Excel row.
  const rowPatches = new Map<number, Map<number, XlsxCellValue>>();
  let cursor = 0;
  for (let i = 1; i < grid.length && cursor < list.items.length; i += 1) {
    const row = grid[i] ?? [];
    if (!isImportedDiscountRow(row, layout)) continue;

    const item = list.items[cursor];
    cursor += 1;
    if (item === undefined) break;
    // Defensive alignment guard: the zipped item's barcode must match this row. If the
    // kept-row predicate ever drifts from the import, skip rather than write the wrong
    // product's participation.
    if (cellText(row, layout.barcode) !== item.barcode) continue;

    const sourceIncluded = cellText(row, layout.included) === DISCOUNT_INCLUDED_YES;
    if (item.included === sourceIncluded) continue;

    const patch = new Map<number, XlsxCellValue>();
    patch.set(layout.included, {
      kind: 'inlineStr',
      value: item.included ? DISCOUNT_INCLUDED_YES : DISCOUNT_INCLUDED_NO,
    });
    rowPatches.set(i + 1, patch);
  }

  const file = patchXlsxCells(source, rowPatches);

  try {
    await prisma.discountList.update({
      where: { id: listId },
      data: { exportedAt: new Date() },
    });
  } catch (err) {
    mapPrismaError(err);
  }

  return { filename: list.sourceFilename ?? DISCOUNT_EXPORT_FILENAME, file };
}
