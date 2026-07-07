// Import service for Trendyol's "Flaş Ürünler" (Teklif Ürünleri) Excel.
//
// Closest sibling of the Advantage import — a single flat block, NO period rows —
// but with the structural novelty of this feature: a row can carry up to two flash
// OFFERS (a 24-hour window and a 3-hour window), each with its own price and
// start/end dates, and the SAME product appears on multiple rows (different dates).
// We read the raw grid via `readWorkbookGrid`, resolve every column by header name
// via `resolveFlashProductLayout`, and persist one list plus one item per offer row
// (barcode → ProductVariant). The raw file is kept for verbatim export. The reduced
// commission per offer is looked up from the seller's Commission Tariff at compute
// time; `currentCommissionPct` (the "Mevcut Komisyon" column) is the flat fallback.

import { prisma } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';
import { readWorkbookGrid, SpreadsheetFileError, type SheetData } from '@pazarsync/spreadsheet';
import { businessZoneEpochToInstant } from '@pazarsync/utils';

import { ValidationError } from '../lib/errors';
import { cellDecimalString, cellInt, cellText } from '../lib/xlsx-grid-cells';
import { resolveFlashProductLayout, type FlashProductLayout } from './flash-product-layout';

const SHEET_NAME = 'TeklifÜrünleri';

// Trendyol stamps the offer windows as "08/07/2026 00:00" text (Istanbul wall
// clock). Parsed into the true instant via the business-timezone helper.
const FLASH_DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/;

/** Parses a "dd/MM/yyyy HH:mm" Istanbul wall-clock string into the true instant, or null. */
function parseFlashDateTime(text: string): Date | null {
  const match = FLASH_DATE_RE.exec(text.trim());
  if (match === null) return null;
  const [, day, month, year, hour, minute] = match;
  if (
    day === undefined ||
    month === undefined ||
    year === undefined ||
    hour === undefined ||
    minute === undefined
  ) {
    return null;
  }
  const epochAsIfUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );
  return businessZoneEpochToInstant(epochAsIfUtc);
}

/** A window date cell → instant. Handles the usual text cell and a defensive real-date cell. */
export function parseFlashWindowCell(row: readonly unknown[], idx: number): Date | null {
  if (idx < 0) return null;
  const raw = row[idx];
  // read-excel-file yields date-formatted cells as a naive UTC Date (the Istanbul
  // wall-clock components embedded as if they were UTC), so it reads ~3h ahead of the
  // real instant. Normalise it through the SAME business-zone frame as the text path,
  // otherwise a window near a sub-period boundary lands in the wrong commission band.
  if (raw instanceof Date) return businessZoneEpochToInstant(raw.getTime());
  const text = cellText(row, idx);
  return text === null ? null : parseFlashDateTime(text);
}

interface ParsedFlashOffer {
  price: string;
  startsAt: Date | null;
  endsAt: Date | null;
}

/**
 * Reads one offer (price + window) from a row. Presence is decided by the price
 * cell: a null price ⇒ no offer for this window. The window dates may still be
 * null (absent/unparseable) — the price is kept regardless.
 */
function parseOffer(
  row: readonly unknown[],
  priceCol: number,
  startCol: number,
  endCol: number,
): ParsedFlashOffer | null {
  const price = cellDecimalString(row, priceCol);
  if (price === null) return null;
  return {
    price,
    startsAt: parseFlashWindowCell(row, startCol),
    endsAt: parseFlashWindowCell(row, endCol),
  };
}

/** Turkish yes-ish cell text ("Var") → boolean; anything else is false. */
function cellIsYes(row: readonly unknown[], idx: number, yes: string): boolean {
  if (idx < 0) return false;
  const text = cellText(row, idx);
  return text !== null && text.trim().toLocaleLowerCase('tr') === yes;
}

interface ParsedFlashRow {
  barcode: string;
  modelCode: string | null;
  productTitle: string;
  category: string | null;
  brand: string | null;
  stock: number | null;
  currentPrice: string;
  customerPrice: string;
  currentCommissionPct: string;
  hasCommissionTariff: boolean;
  campaignedProduct: string | null;
  offer24: ParsedFlashOffer | null;
  offer3: ParsedFlashOffer | null;
  externalId: string | null;
}

function parseRow(row: readonly unknown[], layout: FlashProductLayout): ParsedFlashRow | null {
  const barcode = cellText(row, layout.barcode);
  if (barcode === null) return null;
  const currentPrice = cellDecimalString(row, layout.currentPrice);
  if (currentPrice === null) return null;

  const offer24 = parseOffer(row, layout.offer24Price, layout.offer24Start, layout.offer24End);
  const offer3 = parseOffer(row, layout.offer3Price, layout.offer3Start, layout.offer3End);
  // A row with NEITHER a 24h nor a 3h offer carries no flash decision → skip it.
  if (offer24 === null && offer3 === null) return null;

  return {
    barcode,
    modelCode: layout.modelCode >= 0 ? cellText(row, layout.modelCode) : null,
    productTitle: (layout.productTitle >= 0 ? cellText(row, layout.productTitle) : null) ?? barcode,
    category: layout.category >= 0 ? cellText(row, layout.category) : null,
    brand: layout.brand >= 0 ? cellText(row, layout.brand) : null,
    stock: layout.stock >= 0 ? cellInt(row, layout.stock) : null,
    currentPrice,
    customerPrice: cellDecimalString(row, layout.customerPrice) ?? currentPrice,
    // Verbatim "Mevcut Komisyon" percent (flat fallback commission). Defaults to
    // "0" only if the cell is blank — the real export always carries it.
    currentCommissionPct: cellDecimalString(row, layout.currentCommission) ?? '0',
    hasCommissionTariff: cellIsYes(row, layout.commissionTariffFlag, 'var'),
    campaignedProduct:
      layout.campaignedProduct >= 0 ? cellText(row, layout.campaignedProduct) : null,
    offer24,
    offer3,
    externalId: layout.externalId >= 0 ? cellText(row, layout.externalId) : null,
  };
}

// ─── Entry point ────────────────────────────────────────────────────────────

export interface ImportFlashProductsInput {
  organizationId: string;
  storeId: string;
  file: Buffer;
  filename: string;
  createdBy: string | null;
  name?: string;
}

export interface ImportFlashProductsResult {
  listId: string;
  name: string;
  /** Distinct barcodes across the imported rows. */
  productCount: number;
  /** One item per offer row (the same product can span several rows). */
  itemCount: number;
  matched: number;
  unmatched: number;
  skippedRows: number;
}

function deriveName(input: ImportFlashProductsInput): string {
  const explicit = input.name?.trim();
  if (explicit !== undefined && explicit !== '') return explicit;
  const stem = input.filename.replace(/\.[^.]+$/, '').trim();
  if (stem !== '') return stem;
  return 'Flaş Ürünler';
}

export async function importFlashProducts(
  input: ImportFlashProductsInput,
): Promise<ImportFlashProductsResult> {
  const { organizationId, storeId } = input;

  let grid: SheetData;
  try {
    grid = await readWorkbookGrid(input.file, { sheetName: SHEET_NAME });
  } catch (err) {
    if (err instanceof SpreadsheetFileError) {
      throw new ValidationError([{ field: 'file', code: err.code }]);
    }
    throw err;
  }

  if (grid.length < 2) {
    throw new ValidationError([{ field: 'file', code: 'EMPTY_FLASH_FILE' }]);
  }
  const layout = resolveFlashProductLayout(grid[0] ?? []);
  if (layout === null) {
    throw new ValidationError([{ field: 'file', code: 'INVALID_FLASH_FORMAT' }]);
  }

  const parsed: ParsedFlashRow[] = [];
  let skippedRows = 0;
  for (const row of grid.slice(1)) {
    const parsedRow = parseRow(row, layout);
    if (parsedRow === null) {
      skippedRows += 1;
      continue;
    }
    parsed.push(parsedRow);
  }
  if (parsed.length === 0) {
    throw new ValidationError([{ field: 'file', code: 'EMPTY_FLASH_FILE' }]);
  }

  // Match barcode → variant (store-scoped). Counts are product-level (distinct
  // barcode), since the same product spans several offer rows.
  const distinctBarcodes = [...new Set(parsed.map((p) => p.barcode))];
  const variants = await prisma.productVariant.findMany({
    where: { organizationId, storeId, barcode: { in: distinctBarcodes } },
    select: { id: true, barcode: true },
  });
  const variantByBarcode = new Map(variants.map((v) => [v.barcode, v.id]));
  const matched = distinctBarcodes.filter((barcode) => variantByBarcode.has(barcode)).length;

  const name = deriveName(input);

  try {
    const { listId, itemCount } = await prisma.$transaction(async (tx) => {
      const list = await tx.flashProductList.create({
        data: {
          organizationId,
          storeId,
          name,
          sourceFilename: input.filename,
          sourceFile: new Uint8Array(input.file),
          createdBy: input.createdBy,
        },
      });

      const itemsData = parsed.map((p, index) => ({
        organizationId,
        storeId,
        listId: list.id,
        productVariantId: variantByBarcode.get(p.barcode) ?? null,
        modelCode: p.modelCode,
        barcode: p.barcode,
        productTitle: p.productTitle,
        category: p.category,
        brand: p.brand,
        stock: p.stock,
        externalId: p.externalId,
        currentPrice: p.currentPrice,
        customerPrice: p.customerPrice,
        currentCommissionPct: p.currentCommissionPct,
        hasCommissionTariff: p.hasCommissionTariff,
        campaignedProduct: p.campaignedProduct,
        offer24Price: p.offer24?.price ?? null,
        offer24StartsAt: p.offer24?.startsAt ?? null,
        offer24EndsAt: p.offer24?.endsAt ?? null,
        offer3Price: p.offer3?.price ?? null,
        offer3StartsAt: p.offer3?.startsAt ?? null,
        offer3EndsAt: p.offer3?.endsAt ?? null,
        sortOrder: index,
      }));
      await tx.flashProductItem.createMany({ data: itemsData });
      return { listId: list.id, itemCount: itemsData.length };
    });

    return {
      listId,
      name,
      productCount: distinctBarcodes.length,
      itemCount,
      matched,
      unmatched: distinctBarcodes.length - matched,
      skippedRows,
    };
  } catch (err) {
    mapPrismaError(err);
  }
}
