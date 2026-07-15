// Import service for Trendyol's "İndirimler" (Promosyon > İndirimler) product-selection Excel.
//
// Closest sibling of the Flash import — a single flat block, one row per product, NO
// period rows and NO per-row offers. Trendyol uses the SAME selection sheet for every
// discount type; the discount CONFIG (type + its parameters) is NOT in the file — it
// rides in on the multipart form (already validated by ImportDiscountListFormSchema) and
// is persisted onto the DiscountList row. We read the raw grid via `readWorkbookGrid`,
// resolve every column by header name via `resolveDiscountListLayout`, and persist one
// list plus one item per product row (barcode → ProductVariant). The raw file is kept for
// verbatim export (only the participation column is patched back on export).

import { prisma } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';
import { readWorkbookGrid, SpreadsheetFileError, type SheetData } from '@pazarsync/spreadsheet';

import { ValidationError } from '../lib/errors';
import { cellCurrencyDecimalString, cellText } from '../lib/xlsx-grid-cells';
import {
  DISCOUNT_INCLUDED_YES,
  DISCOUNT_SHEET_NAME,
  resolveDiscountListLayout,
  type DiscountListLayout,
} from './discount-list-layout';
import type { DiscountConfigFields } from '../validators/discount-list.validator';

interface ParsedDiscountRow {
  barcode: string;
  externalId: string | null;
  productTitle: string;
  brand: string | null;
  color: string | null;
  modelCode: string | null;
  currentPrice: string;
  included: boolean;
}

function parseRow(row: readonly unknown[], layout: DiscountListLayout): ParsedDiscountRow | null {
  const barcode = cellText(row, layout.barcode);
  if (barcode === null) return null;
  const currentPrice = cellCurrencyDecimalString(row, layout.currentPrice);
  if (currentPrice === null) return null;

  return {
    barcode,
    externalId: layout.externalId >= 0 ? cellText(row, layout.externalId) : null,
    // Barkod eşleşmese bile satır adı boş kalmasın diye barkoda düş.
    productTitle: (layout.productTitle >= 0 ? cellText(row, layout.productTitle) : null) ?? barcode,
    brand: layout.brand >= 0 ? cellText(row, layout.brand) : null,
    color: layout.color >= 0 ? cellText(row, layout.color) : null,
    modelCode: layout.modelCode >= 0 ? cellText(row, layout.modelCode) : null,
    currentPrice,
    included: cellText(row, layout.included) === DISCOUNT_INCLUDED_YES,
  };
}

// ─── Entry point ────────────────────────────────────────────────────────────

export interface ImportDiscountListInput {
  organizationId: string;
  storeId: string;
  file: Buffer;
  filename: string;
  createdBy: string | null;
  name?: string;
  config: DiscountConfigFields;
}

export interface ImportDiscountListResult {
  listId: string;
  name: string;
  /** One item per product row (barkod ↔ ürün). */
  itemCount: number;
  matched: number;
  unmatched: number;
  skippedRows: number;
}

function deriveName(input: ImportDiscountListInput): string {
  const explicit = input.name?.trim();
  if (explicit !== undefined && explicit !== '') return explicit;
  const stem = input.filename.replace(/\.[^.]+$/, '').trim();
  if (stem !== '') return stem;
  return 'İndirim Listesi';
}

/** String config alanlarını DiscountList Int kolonuna indirir (yoksa null). */
function intOrNull(value: string | undefined): number | null {
  return value === undefined ? null : Number(value);
}

export async function importDiscountList(
  input: ImportDiscountListInput,
): Promise<ImportDiscountListResult> {
  const { organizationId, storeId, config } = input;

  let grid: SheetData;
  try {
    grid = await readWorkbookGrid(input.file, { sheetName: DISCOUNT_SHEET_NAME });
  } catch (err) {
    if (err instanceof SpreadsheetFileError) {
      throw new ValidationError([{ field: 'file', code: err.code }]);
    }
    throw err;
  }

  if (grid.length < 2) {
    throw new ValidationError([{ field: 'file', code: 'EMPTY_DISCOUNT_FILE' }]);
  }
  const layout = resolveDiscountListLayout(grid[0] ?? []);
  if (layout === null) {
    throw new ValidationError([{ field: 'file', code: 'INVALID_DISCOUNT_FORMAT' }]);
  }

  const parsed: ParsedDiscountRow[] = [];
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
    throw new ValidationError([{ field: 'file', code: 'EMPTY_DISCOUNT_FILE' }]);
  }

  // Match barcode → variant (store-scoped). One row per product, so match counts
  // are row-level (matched + unmatched === itemCount).
  const distinctBarcodes = [...new Set(parsed.map((p) => p.barcode))];
  const variants = await prisma.productVariant.findMany({
    where: { organizationId, storeId, barcode: { in: distinctBarcodes } },
    select: { id: true, barcode: true },
  });
  const variantByBarcode = new Map(variants.map((v) => [v.barcode, v.id]));
  const matched = parsed.filter((p) => variantByBarcode.has(p.barcode)).length;

  const name = deriveName(input);

  try {
    const { listId, itemCount } = await prisma.$transaction(async (tx) => {
      const list = await tx.discountList.create({
        data: {
          organizationId,
          storeId,
          name,
          discountType: config.discountType,
          valueKind: config.valueKind ?? null,
          value: config.value ?? null,
          minBasketAmount: config.minBasketAmount ?? null,
          minQuantity: intOrNull(config.minQuantity),
          buyQuantity: intOrNull(config.buyQuantity),
          payQuantity: intOrNull(config.payQuantity),
          nthIndex: intOrNull(config.nthIndex),
          orderLimit: intOrNull(config.orderLimit),
          startsAt: config.startsAt ?? null,
          endsAt: config.endsAt ?? null,
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
        externalId: p.externalId,
        productTitle: p.productTitle,
        brand: p.brand,
        color: p.color,
        barcode: p.barcode,
        modelCode: p.modelCode,
        currentPrice: p.currentPrice,
        included: p.included,
        sortOrder: index,
      }));
      await tx.discountListItem.createMany({ data: itemsData });
      return { listId: list.id, itemCount: itemsData.length };
    });

    return {
      listId,
      name,
      itemCount,
      matched,
      unmatched: parsed.length - matched,
      skippedRows,
    };
  } catch (err) {
    mapPrismaError(err);
  }
}
