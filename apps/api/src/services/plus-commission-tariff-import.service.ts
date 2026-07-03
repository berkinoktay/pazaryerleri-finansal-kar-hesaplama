// Import service for Trendyol's "Plus Komisyon" Excel.
//
// Simpler than the product commission import: the Plus sheet is a single fixed
// layout with ONE 7-day period and, per product, ONE reduced Plus offer (a price
// ceiling + a lower commission). We read the raw grid via `readWorkbookGrid`,
// resolve every column by header name via `resolvePlusTariffLayout`, and persist
// one tariff (carrying the single folded period) plus one item per product row,
// joining barcode → ProductVariant. The raw file is kept for verbatim export.
// Profit is computed on read; commission percents are stored verbatim ("19",
// "15.4") — the engine's commission rate IS a percent.

import { prisma } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';
import { readWorkbookGrid, SpreadsheetFileError, type SheetData } from '@pazarsync/spreadsheet';

import { ValidationError } from '../lib/errors';
import { parseTariffPeriodLabel } from '../lib/tariff-period';
import { cellDecimalString, cellInt, cellText } from '../lib/xlsx-grid-cells';
import { resolvePlusTariffLayout, type PlusTariffLayout } from './plus-commission-tariff-layout';

const SHEET_NAME = 'TyPlusÜrünleri';

interface ParsedPlusRow {
  barcode: string;
  stockCode: string | null;
  productTitle: string;
  category: string | null;
  brand: string | null;
  size: string | null;
  modelCode: string | null;
  stock: number | null;
  currentPrice: string;
  commissionBasePrice: string;
  currentCommissionPct: string;
  plusPriceUpperLimit: string;
  plusCommissionPct: string;
  plusCommissionBasePrice: string;
  externalId: string | null;
  tariffGroup: string | null;
  cancelled: boolean;
}

function parseRow(row: readonly unknown[], layout: PlusTariffLayout): ParsedPlusRow | null {
  const barcode = cellText(row, layout.barcode);
  if (barcode === null) return null;
  // Prefer Model Kodu, then Satıcı Stok Kodu — same order as the product import.
  const stockCode =
    (layout.modelCode >= 0 ? cellText(row, layout.modelCode) : null) ??
    (layout.sellerStockCode >= 0 ? cellText(row, layout.sellerStockCode) : null);
  return {
    barcode,
    stockCode,
    productTitle: (layout.productTitle >= 0 ? cellText(row, layout.productTitle) : null) ?? barcode,
    category: layout.category >= 0 ? cellText(row, layout.category) : null,
    brand: layout.brand >= 0 ? cellText(row, layout.brand) : null,
    size: layout.size >= 0 ? cellText(row, layout.size) : null,
    modelCode: layout.modelCode >= 0 ? cellText(row, layout.modelCode) : null,
    stock: layout.stock >= 0 ? cellInt(row, layout.stock) : null,
    currentPrice: cellDecimalString(row, layout.currentPrice) ?? '0',
    commissionBasePrice:
      (layout.commissionBasePrice >= 0
        ? cellDecimalString(row, layout.commissionBasePrice)
        : null) ??
      cellDecimalString(row, layout.currentPrice) ??
      '0',
    currentCommissionPct: cellDecimalString(row, layout.currentCommission) ?? '0',
    plusPriceUpperLimit: cellDecimalString(row, layout.plusPriceUpperLimit) ?? '0',
    plusCommissionPct: cellDecimalString(row, layout.plusCommissionPct) ?? '0',
    plusCommissionBasePrice:
      (layout.plusCommissionBasePrice >= 0
        ? cellDecimalString(row, layout.plusCommissionBasePrice)
        : null) ??
      cellDecimalString(row, layout.plusPriceUpperLimit) ??
      '0',
    externalId: layout.externalId >= 0 ? cellText(row, layout.externalId) : null,
    tariffGroup: layout.tariffGroup >= 0 ? cellText(row, layout.tariffGroup) : null,
    cancelled: layout.cancelled >= 0 ? (cellInt(row, layout.cancelled) ?? 0) !== 0 : false,
  };
}

// ─── Entry point ────────────────────────────────────────────────────────────

export interface ImportPlusTariffInput {
  organizationId: string;
  storeId: string;
  file: Buffer;
  filename: string;
  createdBy: string | null;
  name?: string;
  now: Date;
}

export interface ImportPlusTariffResult {
  tariffId: string;
  productCount: number;
  itemCount: number;
  matched: number;
  unmatched: number;
  skippedRows: number;
}

function deriveName(input: ImportPlusTariffInput, fallbackLabel: string | null): string {
  const explicit = input.name?.trim();
  if (explicit !== undefined && explicit !== '') return explicit;
  const stem = input.filename.replace(/\.[^.]+$/, '').trim();
  if (stem !== '') return stem;
  return fallbackLabel ?? 'Plus Komisyon Tarifesi';
}

export async function importPlusTariff(
  input: ImportPlusTariffInput,
): Promise<ImportPlusTariffResult> {
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
    throw new ValidationError([{ field: 'file', code: 'EMPTY_TARIFF_FILE' }]);
  }
  const layout = resolvePlusTariffLayout(grid[0] ?? []);
  if (layout === null) {
    throw new ValidationError([{ field: 'file', code: 'INVALID_PLUS_TARIFF_FORMAT' }]);
  }

  const parsed: ParsedPlusRow[] = [];
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
    throw new ValidationError([{ field: 'file', code: 'EMPTY_TARIFF_FILE' }]);
  }

  // The single 7-day period label is shared across rows — read it from the first
  // data row (or scan for the first non-empty). Null when the file omits it.
  const year = input.now.getUTCFullYear();
  let periodLabel: string | null = null;
  if (layout.periodLabel >= 0) {
    for (const row of grid.slice(1)) {
      periodLabel = cellText(row, layout.periodLabel);
      if (periodLabel !== null) break;
    }
  }
  if (periodLabel === null) {
    throw new ValidationError([{ field: 'file', code: 'NO_TARIFF_PERIOD' }]);
  }
  const { startsAt, endsAt } = parseTariffPeriodLabel(periodLabel, year);

  // Match barcode → variant (store-scoped).
  const barcodes = [...new Set(parsed.map((p) => p.barcode))];
  const variants = await prisma.productVariant.findMany({
    where: { organizationId, storeId, barcode: { in: barcodes } },
    select: { id: true, barcode: true },
  });
  const variantByBarcode = new Map(variants.map((v) => [v.barcode, v.id]));
  const matched = parsed.filter((p) => variantByBarcode.has(p.barcode)).length;

  const name = deriveName(input, periodLabel);

  try {
    const { tariffId, itemCount } = await prisma.$transaction(async (tx) => {
      const tariff = await tx.plusCommissionTariff.create({
        data: {
          organizationId,
          storeId,
          name,
          sourceFilename: input.filename,
          sourceFile: new Uint8Array(input.file),
          dateRangeLabel: periodLabel,
          dayCount: layout.dayCount,
          startsAt,
          endsAt,
          createdBy: input.createdBy,
        },
      });

      const itemsData = parsed.map((p, index) => ({
        organizationId,
        storeId,
        tariffId: tariff.id,
        productVariantId: variantByBarcode.get(p.barcode) ?? null,
        barcode: p.barcode,
        stockCode: p.stockCode,
        productTitle: p.productTitle,
        category: p.category,
        brand: p.brand,
        size: p.size,
        modelCode: p.modelCode,
        stock: p.stock,
        currentPrice: p.currentPrice,
        commissionBasePrice: p.commissionBasePrice,
        currentCommissionPct: p.currentCommissionPct,
        plusPriceUpperLimit: p.plusPriceUpperLimit,
        plusCommissionPct: p.plusCommissionPct,
        plusCommissionBasePrice: p.plusCommissionBasePrice,
        externalId: p.externalId,
        tariffGroup: p.tariffGroup,
        cancelled: p.cancelled,
        sortOrder: index,
      }));
      await tx.plusCommissionTariffItem.createMany({ data: itemsData });
      return { tariffId: tariff.id, itemCount: itemsData.length };
    });

    return {
      tariffId,
      productCount: parsed.length,
      itemCount,
      matched,
      unmatched: parsed.length - matched,
      skippedRows,
    };
  } catch (err) {
    mapPrismaError(err);
  }
}
