// Export service for the Flash Products (Flaş Ürünler) feature.
//
// Like the other campaign-tariff exports, the seller re-uploads the result to
// Trendyol VERBATIM, so we patch their choices into the EXACT original file (kept at
// import as `sourceFile`) via the shared byte-preserving `patchXlsxCells` helper.
// Every other cell stays byte-for-byte intact, and a list with NO selections streams
// back verbatim (nothing to patch → the source bytes unchanged).
//
// Unlike the tariff exports there are NO periods, so this is ONE file (no buckets /
// zip). Per the authoritative export contract (Berkin), participation is written into
// two columns:
//   • "Güncellenecek Fiyat" (J) ← one of THREE literal labels: "24 Saat" (H24 offer),
//     "3 Saat" (H3 offer), or "Senin Belirlediğin Flaş Fiyatı" (custom price).
//   • "Senin Belirlediğin Flaş Fiyatı" (M) ← the numeric custom price, ONLY on a
//     custom selection. An offer selection does NOT touch M — Trendyol reads the price
//     from its own 24 Saat / 3 Saat (K/L) columns.
// A row with no selection is left entirely untouched.
//
// The vertical's structural novelty (the SAME product spans several date rows) means
// selections are per-ROW, not per-barcode: we zip the sortOrder-ordered items with the
// file's imported (non-skipped) data rows in order, so each row's choice lands on its
// OWN Excel row.

import { Prisma, prisma, type FlashOfferType } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';
import { readWorkbookGrid, SpreadsheetFileError, type SheetData } from '@pazarsync/spreadsheet';

import { ConflictError, NotFoundError } from '../lib/errors';
import { cellDecimalString, cellText } from '../lib/xlsx-grid-cells';
import { patchXlsxCells, type XlsxCellValue } from '../lib/xlsx-patch';
import { resolveFlashProductLayout, type FlashProductLayout } from './flash-product-layout';

const SHEET_NAME = 'TeklifÜrünleri';

// Fixed ASCII output name — a flash list has no periods, so no window suffix logic.
const FLASH_EXPORT_FILENAME = 'flas-urunler.xlsx';

// Trendyol's literal "Güncellenecek Fiyat" (J) fill values the seller re-uploads
// verbatim. Casing to be confirmed by a live round-trip (design §5).
const FLASH_UPDATE_LABEL_24H = '24 Saat';
const FLASH_UPDATE_LABEL_3H = '3 Saat';
const FLASH_UPDATE_LABEL_CUSTOM = 'Senin Belirlediğin Flaş Fiyatı';

/** The J label for a chosen offer window. */
const FLASH_OFFER_UPDATE_LABEL: Record<FlashOfferType, string> = {
  H24: FLASH_UPDATE_LABEL_24H,
  H3: FLASH_UPDATE_LABEL_3H,
};

export interface ExportFlashProductsResult {
  filename: string;
  file: Buffer;
}

/** The item fields the export needs to resolve one row's write-back cells. */
export interface FlashExportItem {
  readonly selectedOffer: FlashOfferType | null;
  readonly customPrice: Prisma.Decimal | null;
}

/** The cells one selected flash row writes: the J label, and the M custom price (null on an offer). */
export interface FlashExportCells {
  /** "Güncellenecek Fiyat" (J) label — "24 Saat" / "3 Saat" / "Senin Belirlediğin Flaş Fiyatı". */
  readonly updateLabel: string;
  /** "Senin Belirlediğin Flaş Fiyatı" (M) price (2dp), only when custom; null on an offer. */
  readonly customPrice: string | null;
}

/**
 * The write-back cells for one Flash item, or null when the row carries no selection.
 * A row is selected when it has a CUSTOM price OR a chosen offer (the two are mutually
 * exclusive in the UI). Checked custom-FIRST so a custom-only row still resolves,
 * mirroring the Advantage export's `custom ?? tier` ordering. An offer selection writes
 * ONLY the J label (M stays untouched — Trendyol reads its own K/L offer price); a
 * custom selection writes the J label AND the numeric M price.
 */
export function resolveFlashExportCells(item: FlashExportItem): FlashExportCells | null {
  if (item.customPrice !== null) {
    return { updateLabel: FLASH_UPDATE_LABEL_CUSTOM, customPrice: item.customPrice.toFixed(2) };
  }
  if (item.selectedOffer !== null) {
    return { updateLabel: FLASH_OFFER_UPDATE_LABEL[item.selectedOffer], customPrice: null };
  }
  return null;
}

/**
 * True when the import kept an item for this data row (so it must consume one item when
 * zipping). Mirrors `flash-product-import`'s `parseRow` skip rules: a barcode + a
 * current price + at least one offer (24h or 3h). Kept in sync with that contract.
 */
function isImportedFlashRow(row: readonly unknown[], layout: FlashProductLayout): boolean {
  if (cellText(row, layout.barcode) === null) return false;
  if (cellDecimalString(row, layout.currentPrice) === null) return false;
  const has24 = layout.offer24Price >= 0 && cellDecimalString(row, layout.offer24Price) !== null;
  const has3 = layout.offer3Price >= 0 && cellDecimalString(row, layout.offer3Price) !== null;
  return has24 || has3;
}

/**
 * Produces the seller's re-uploadable Trendyol file: the original upload with each
 * selected row's participation label written into "Güncellenecek Fiyat" (and the custom
 * price into "Senin Belirlediğin Flaş Fiyatı" on custom rows). Every other cell is
 * byte-for-byte unchanged; a list with no selections streams back verbatim. Marks the
 * list exported. Throws `NotFoundError` when the list is not in this store,
 * `ConflictError` if no source file was kept, it is unreadable, or it has no
 * "Güncellenecek Fiyat" column to write back.
 */
export async function exportFlashProducts(
  orgId: string,
  storeId: string,
  listId: string,
): Promise<ExportFlashProductsResult> {
  let list;
  try {
    list = await prisma.flashProductList.findFirst({
      where: { id: listId, organizationId: orgId, storeId },
      select: {
        sourceFile: true,
        items: {
          orderBy: { sortOrder: 'asc' },
          select: { barcode: true, selectedOffer: true, customPrice: true },
        },
      },
    });
  } catch (err) {
    mapPrismaError(err);
  }

  if (list === null) {
    throw new NotFoundError('FlashProductList', listId);
  }
  if (list.sourceFile === null) {
    throw new ConflictError('Flash product list has no stored source file to export');
  }

  const source = Buffer.from(list.sourceFile);
  let grid: SheetData;
  try {
    grid = await readWorkbookGrid(source, { sheetName: SHEET_NAME });
  } catch (err) {
    // The stored source parsed cleanly at import; if the bytes no longer read, that is
    // a conflict with the stored server state (409), not our bug (500) — the same
    // contract as the recognizable-format / missing-column guards just below.
    if (err instanceof SpreadsheetFileError) {
      throw new ConflictError('Stored flash product file could not be read');
    }
    throw err;
  }
  const layout = resolveFlashProductLayout(grid[0] ?? []);
  if (layout === null) {
    throw new ConflictError('Stored flash product file is not a recognizable Trendyol export');
  }
  if (layout.updatedPrice < 0) {
    throw new ConflictError(
      'Stored flash product file has no "Güncellenecek Fiyat" column to write back',
    );
  }

  // Zip the sortOrder-ordered items with the file's imported (non-skipped) data rows in
  // order: item[k] is the k-th kept row. This lands a per-ROW selection on its OWN Excel
  // row, since the same product spans several date rows (a per-barcode map would bleed a
  // choice onto every date of the product). Keyed by the 1-based Excel row.
  const rowPatches = new Map<number, Map<number, XlsxCellValue>>();
  let cursor = 0;
  for (let i = 1; i < grid.length && cursor < list.items.length; i += 1) {
    const row = grid[i] ?? [];
    if (!isImportedFlashRow(row, layout)) continue;

    const item = list.items[cursor];
    cursor += 1;
    if (item === undefined) break;
    // Defensive alignment guard: the zipped item's barcode must match this row. If the
    // kept-row predicate ever drifts from the import, skip rather than write a price into
    // the wrong product's row.
    if (cellText(row, layout.barcode) !== item.barcode) continue;

    const cells = resolveFlashExportCells(item);
    if (cells === null) continue;

    const patch = new Map<number, XlsxCellValue>();
    patch.set(layout.updatedPrice, { kind: 'inlineStr', value: cells.updateLabel });
    if (cells.customPrice !== null && layout.customFlashPrice >= 0) {
      patch.set(layout.customFlashPrice, { kind: 'number', value: cells.customPrice });
    }
    rowPatches.set(i + 1, patch);
  }

  const file = patchXlsxCells(source, rowPatches);

  try {
    await prisma.flashProductList.update({
      where: { id: listId },
      data: { exportedAt: new Date() },
    });
  } catch (err) {
    mapPrismaError(err);
  }

  return { filename: FLASH_EXPORT_FILENAME, file };
}
