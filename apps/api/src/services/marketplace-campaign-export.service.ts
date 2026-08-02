// Export service for the Kampanyalar (Trendyol'un kurguladığı kampanyalara katılım) feature.
//
// Like the İndirimler sibling, the seller re-uploads the result to Trendyol VERBATIM, so we
// patch their choices into the EXACT original file (kept at import as `sourceFile`) via the
// shared byte-preserving `patchXlsxCells` helper. Every other cell stays byte-for-byte intact.
//
// The ONE column this vertical writes is "Kampanyalı Satış Fiyatı" (`layout.campaignPrice`),
// and unlike İndirimler's "Evet"/"Hayır" toggle, the source cell here is ALWAYS empty — there
// is no "deviation" comparison. Every row with a resolved export price gets patched; a row
// whose selection is NONE (or CUSTOM with no stored price) is left entirely untouched. Because
// every export is regenerated from the pristine stored bytes, a row the seller deselects
// naturally comes back blank — there is no separate "patch it back to blank" path to write.
//
// Row alignment mirrors the import: the sortOrder-ordered items are zipped against the file's
// imported (non-skipped) data rows in order, with a barcode defensive guard so a predicate
// drift skips rather than writing into the wrong product's row.

import { prisma, Prisma } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';
import { readWorkbookGrid, SpreadsheetFileError, type SheetData } from '@pazarsync/spreadsheet';

import { ConflictError, NotFoundError } from '../lib/errors';
import { cellCurrencyDecimalString, cellText } from '../lib/xlsx-grid-cells';
import { patchXlsxCells, type XlsxCellValue } from '../lib/xlsx-patch';
import {
  resolveMarketplaceCampaignLayout,
  type MarketplaceCampaignLayout,
} from './marketplace-campaign-layout';

// Fallback output name when the list kept no original filename.
const CAMPAIGN_EXPORT_FILENAME = 'kampanya.xlsx';

export interface ExportMarketplaceCampaignResult {
  filename: string;
  file: Buffer;
}

/** Dışa aktarılacak fiyat, ya da satır katılmıyorsa null. */
export function resolveCampaignExportPrice(item: {
  readonly selection: 'NONE' | 'MAX' | 'CUSTOM';
  readonly maxPrice: Prisma.Decimal;
  readonly customPrice: Prisma.Decimal | null;
}): string | null {
  if (item.selection === 'MAX') return item.maxPrice.toFixed(2);
  // CUSTOM seçili ama fiyat yoksa yazacak bir şey yok — satır katılmamış sayılır. Bu artık
  // API sınırında (CUSTOM_PRICE_REQUIRED) reddedilir; burası eski bir satıra karşı ikinci
  // savunma katmanı.
  if (item.selection === 'CUSTOM' && item.customPrice !== null) {
    return item.customPrice.toFixed(2);
  }
  return null;
}

/**
 * True when the import kept an item for this data row (so it must consume one item when
 * zipping). Mirrors `marketplace-campaign-import`'s `parseRow` skip rule BİREBİR: barkod +
 * mevcut fiyat + maksimum fiyat okunabilir olmalı. Kept in sync with that contract.
 */
function isImportedCampaignRow(
  row: readonly unknown[],
  layout: MarketplaceCampaignLayout,
): boolean {
  return (
    cellText(row, layout.barcode) !== null &&
    cellCurrencyDecimalString(row, layout.currentPrice) !== null &&
    cellCurrencyDecimalString(row, layout.maxPrice) !== null
  );
}

/**
 * Produces the seller's re-uploadable Trendyol file: the original upload with each row's
 * chosen price written into "Kampanyalı Satış Fiyatı" — MAX writes the max price, CUSTOM
 * writes the custom price, NONE leaves the cell untouched (it was already empty in the
 * source). Every other cell is byte-for-byte unchanged. Marks the campaign exported. Throws
 * `NotFoundError` when the campaign is not in this store, `ConflictError` if no source file
 * was kept, it is unreadable, or it is not a recognizable Kampanyalar export.
 */
export async function exportMarketplaceCampaign(
  orgId: string,
  storeId: string,
  campaignId: string,
): Promise<ExportMarketplaceCampaignResult> {
  let campaign;
  try {
    campaign = await prisma.marketplaceCampaignList.findFirst({
      where: { id: campaignId, organizationId: orgId, storeId },
      select: {
        sourceFile: true,
        sourceFilename: true,
        items: {
          orderBy: { sortOrder: 'asc' },
          select: { barcode: true, selection: true, maxPrice: true, customPrice: true },
        },
      },
    });
  } catch (err) {
    mapPrismaError(err);
  }

  if (campaign === null) {
    throw new NotFoundError('MarketplaceCampaignList', campaignId);
  }
  if (campaign.sourceFile === null) {
    throw new ConflictError('Marketplace campaign has no stored source file to export');
  }

  const source = Buffer.from(campaign.sourceFile);
  let grid: SheetData;
  try {
    // Sayfa adı kampanyaya göre değiştiği için sheetName BİLİNÇLİ verilmez — import'un aynı
    // gerekçesi (bkz. marketplace-campaign-import.service.ts).
    grid = await readWorkbookGrid(source);
  } catch (err) {
    // The stored source parsed cleanly at import; if the bytes no longer read, that is a
    // conflict with the stored server state (409), not our bug (500) — the same contract as
    // the recognizable-format guard just below.
    if (err instanceof SpreadsheetFileError) {
      throw new ConflictError('Stored marketplace campaign file could not be read');
    }
    throw err;
  }
  const layout = resolveMarketplaceCampaignLayout(grid[0] ?? []);
  if (layout === null) {
    throw new ConflictError(
      'Stored marketplace campaign file is not a recognizable Trendyol export',
    );
  }

  // Zip the sortOrder-ordered items with the file's imported (non-skipped) data rows in
  // order: item[k] is the k-th kept row. Only rows with a resolved export price are patched
  // — a NONE (or priceless CUSTOM) selection leaves the already-empty source cell untouched.
  // Keyed by the 1-based Excel row.
  const rowPatches = new Map<number, Map<number, XlsxCellValue>>();
  let cursor = 0;
  for (let i = 1; i < grid.length && cursor < campaign.items.length; i += 1) {
    const row = grid[i] ?? [];
    if (!isImportedCampaignRow(row, layout)) continue;

    const item = campaign.items[cursor];
    cursor += 1;
    if (item === undefined) break;
    // Defensive alignment guard: the zipped item's barcode must match this row. If the
    // kept-row predicate ever drifts from the import, skip rather than write the wrong
    // product's price.
    if (cellText(row, layout.barcode) !== item.barcode) continue;

    const price = resolveCampaignExportPrice(item);
    if (price === null) continue;

    const patch = new Map<number, XlsxCellValue>();
    patch.set(layout.campaignPrice, { kind: 'number', value: price });
    rowPatches.set(i + 1, patch);
  }

  const file = patchXlsxCells(source, rowPatches);

  try {
    await prisma.marketplaceCampaignList.update({
      where: { id: campaignId },
      data: { exportedAt: new Date() },
    });
  } catch (err) {
    mapPrismaError(err);
  }

  return { filename: campaign.sourceFilename ?? CAMPAIGN_EXPORT_FILENAME, file };
}
