// Import service for Trendyol's "Ürün Komisyon Tarifeleri" Excel.
//
// The export is a FIXED-LAYOUT sheet (KomisyonTarifeleriÜrünleri) with DUPLICATE
// column headers — "1.KOMİSYON".."4.KOMİSYON" appear once for the 3-day period
// and again for the 4-day period — so header matching cannot disambiguate them.
// We read the raw grid via `readWorkbookGrid` (which also fixes Trendyol's bogus
// single-cell <dimension>) and map columns BY POSITION, validating a few header
// cells so a format drift fails fast.
//
// Data model: each band is a PRICE RANGE [lower, upper] (shared across periods);
// each present period (3-day / 4-day) contributes its own commission set. We
// persist one period row per present period and one item per (product × period),
// joining barcode → ProductVariant. Profit is computed later, on read.

import { prisma } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';
import { readWorkbookGrid, SpreadsheetFileError, type SheetData } from '@pazarsync/spreadsheet';

import { ValidationError } from '../lib/errors';
import { parseTariffPeriodLabel } from './commission-tariff.types';

const SHEET_NAME = 'KomisyonTarifeleriÜrünleri';

// Fixed 0-based column layout of the Trendyol export.
const COL = {
  productTitle: 0,
  barcode: 1,
  sellerStockCode: 2,
  size: 3,
  modelCode: 4,
  category: 5,
  brand: 6,
  stock: 7,
  band1Lower: 8,
  band2Upper: 9,
  band2Lower: 10,
  band3Upper: 11,
  band3Lower: 12,
  band4Upper: 13,
  period3Label: 14,
  comm3: [15, 16, 17, 18],
  period4Label: 19,
  comm4: [20, 21, 22, 23],
  currentCommission: 25,
  currentTsf: 26,
} as const;

// A few header cells verified against the file so a layout change fails fast
// instead of silently importing garbage by position.
const EXPECTED_HEADERS: ReadonlyArray<readonly [number, string]> = [
  [COL.barcode, 'BARKOD'],
  [COL.band1Lower, '1.Fiyat Alt Limit'],
  [COL.period4Label, 'Tarih aralığı (4 Gün)'],
  [COL.currentTsf, 'GÜNCEL TSF'],
];

// ─── Cell readers (grid cells are string | number | boolean | Date | null) ──

function cellText(row: readonly unknown[], idx: number): string | null {
  const value = row[idx];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof value === 'number') return String(value);
  return null;
}

function cellDecimalString(row: readonly unknown[], idx: number): string | null {
  const value = row[idx];
  if (typeof value === 'number') return value.toString();
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    // Turkish formatted strings ("1.234,56") are rare here (cells are numeric),
    // but coerce them defensively; a plain "777.1" keeps its dot decimal.
    const normalized = trimmed.includes(',')
      ? trimmed.replace(/\./g, '').replace(',', '.')
      : trimmed;
    return /^-?\d+(\.\d+)?$/.test(normalized) ? normalized : null;
  }
  return null;
}

function cellInt(row: readonly unknown[], idx: number): number | null {
  const decimal = cellDecimalString(row, idx);
  return decimal === null ? null : Math.trunc(Number(decimal));
}

// ─── Parsed row + band assembly ─────────────────────────────────────────────

interface PriceBrackets {
  band1Lower: string | null;
  band2Lower: string | null;
  band2Upper: string | null;
  band3Lower: string | null;
  band3Upper: string | null;
  band4Upper: string | null;
}

interface ParsedRow {
  barcode: string;
  stockCode: string | null;
  productTitle: string;
  category: string | null;
  brand: string | null;
  stock: number | null;
  currentPrice: string;
  currentCommissionPct: string;
  brackets: PriceBrackets;
  comm3: ReadonlyArray<string | null>;
  comm4: ReadonlyArray<string | null>;
}

/**
 * Builds a period's band JSON from the shared price brackets + that period's
 * commissions. Null limits are OMITTED (not stored as JSON null) so the value
 * stays a clean `Record<string, string>` array — `parseStoredBands` reads an
 * absent limit back as null. Bands whose commission is missing are skipped.
 */
function bandsForPeriod(
  b: PriceBrackets,
  comms: ReadonlyArray<string | null>,
): Record<string, string>[] {
  const specs: ReadonlyArray<{
    key: string;
    lower: string | null;
    upper: string | null;
    comm: string | null;
  }> = [
    { key: 'band1', lower: b.band1Lower, upper: null, comm: comms[0] ?? null },
    { key: 'band2', lower: b.band2Lower, upper: b.band2Upper, comm: comms[1] ?? null },
    { key: 'band3', lower: b.band3Lower, upper: b.band3Upper, comm: comms[2] ?? null },
    { key: 'band4', lower: null, upper: b.band4Upper, comm: comms[3] ?? null },
  ];
  const bands: Record<string, string>[] = [];
  for (const spec of specs) {
    if (spec.comm === null) continue;
    const json: Record<string, string> = { key: spec.key, commissionPct: spec.comm };
    if (spec.lower !== null) json.lowerLimit = spec.lower;
    if (spec.upper !== null) json.upperLimit = spec.upper;
    bands.push(json);
  }
  return bands;
}

function assertExpectedFormat(headerRow: readonly unknown[]): void {
  for (const [idx, expected] of EXPECTED_HEADERS) {
    const actual = cellText(headerRow, idx);
    if (actual === null || actual.normalize('NFC') !== expected.normalize('NFC')) {
      throw new ValidationError([{ field: 'file', code: 'INVALID_TARIFF_FORMAT' }]);
    }
  }
}

function parseRow(row: readonly unknown[]): ParsedRow | null {
  const barcode = cellText(row, COL.barcode);
  if (barcode === null) return null;
  return {
    barcode,
    stockCode: cellText(row, COL.modelCode) ?? cellText(row, COL.sellerStockCode),
    productTitle: cellText(row, COL.productTitle) ?? barcode,
    category: cellText(row, COL.category),
    brand: cellText(row, COL.brand),
    stock: cellInt(row, COL.stock),
    currentPrice: cellDecimalString(row, COL.currentTsf) ?? '0',
    currentCommissionPct: cellDecimalString(row, COL.currentCommission) ?? '0',
    brackets: {
      band1Lower: cellDecimalString(row, COL.band1Lower),
      band2Lower: cellDecimalString(row, COL.band2Lower),
      band2Upper: cellDecimalString(row, COL.band2Upper),
      band3Lower: cellDecimalString(row, COL.band3Lower),
      band3Upper: cellDecimalString(row, COL.band3Upper),
      band4Upper: cellDecimalString(row, COL.band4Upper),
    },
    comm3: COL.comm3.map((idx) => cellDecimalString(row, idx)),
    comm4: COL.comm4.map((idx) => cellDecimalString(row, idx)),
  };
}

interface PeriodSpec {
  label: string;
  startsAt: Date | null;
  endsAt: Date | null;
  sortOrder: number;
  pick: (row: ParsedRow) => ReadonlyArray<string | null>;
}

// ─── Entry point ────────────────────────────────────────────────────────────

export interface ImportTariffInput {
  organizationId: string;
  storeId: string;
  file: Buffer;
  filename: string;
  createdBy: string | null;
  name?: string;
  now: Date;
}

export interface ImportTariffResult {
  tariffId: string;
  productCount: number;
  periodCount: number;
  itemCount: number;
  matched: number;
  unmatched: number;
  skippedRows: number;
}

function deriveName(input: ImportTariffInput, fallbackLabel: string | null): string {
  const explicit = input.name?.trim();
  if (explicit !== undefined && explicit !== '') return explicit;
  const stem = input.filename.replace(/\.[^.]+$/, '').trim();
  if (stem !== '') return stem;
  return fallbackLabel ?? 'Komisyon Tarifesi';
}

export async function importTariff(input: ImportTariffInput): Promise<ImportTariffResult> {
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
  assertExpectedFormat(grid[0] ?? []);

  const parsed: ParsedRow[] = [];
  let skippedRows = 0;
  for (const row of grid.slice(1)) {
    const parsedRow = parseRow(row);
    if (parsedRow === null) {
      skippedRows += 1;
      continue;
    }
    parsed.push(parsedRow);
  }
  if (parsed.length === 0) {
    throw new ValidationError([{ field: 'file', code: 'EMPTY_TARIFF_FILE' }]);
  }

  // Period labels are tariff-level (identical on every row) — read from the first.
  const firstRow = grid[1] ?? [];
  const year = input.now.getUTCFullYear();
  const periods: PeriodSpec[] = [];
  const label3 = cellText(firstRow, COL.period3Label);
  if (label3 !== null) {
    const { startsAt, endsAt } = parseTariffPeriodLabel(label3, year);
    periods.push({
      label: label3,
      startsAt,
      endsAt,
      sortOrder: periods.length,
      pick: (r) => r.comm3,
    });
  }
  const label4 = cellText(firstRow, COL.period4Label);
  if (label4 !== null) {
    const { startsAt, endsAt } = parseTariffPeriodLabel(label4, year);
    periods.push({
      label: label4,
      startsAt,
      endsAt,
      sortOrder: periods.length,
      pick: (r) => r.comm4,
    });
  }
  if (periods.length === 0) {
    throw new ValidationError([{ field: 'file', code: 'NO_TARIFF_PERIOD' }]);
  }

  // Match barcode → variant (store-scoped).
  const barcodes = [...new Set(parsed.map((p) => p.barcode))];
  const variants = await prisma.productVariant.findMany({
    where: { organizationId, storeId, barcode: { in: barcodes } },
    select: { id: true, barcode: true },
  });
  const variantByBarcode = new Map(variants.map((v) => [v.barcode, v.id]));
  const matched = parsed.filter((p) => variantByBarcode.has(p.barcode)).length;

  const name = deriveName(input, periods[0]?.label ?? null);

  try {
    const { tariffId, itemCount } = await prisma.$transaction(async (tx) => {
      const tariff = await tx.commissionTariff.create({
        data: {
          organizationId,
          storeId,
          name,
          sourceFilename: input.filename,
          createdBy: input.createdBy,
        },
      });

      let items = 0;
      for (const period of periods) {
        const periodRow = await tx.commissionTariffPeriod.create({
          data: {
            organizationId,
            storeId,
            tariffId: tariff.id,
            dateRangeLabel: period.label,
            startsAt: period.startsAt,
            endsAt: period.endsAt,
            sortOrder: period.sortOrder,
          },
        });
        const itemsData = parsed.map((p) => ({
          organizationId,
          storeId,
          periodId: periodRow.id,
          productVariantId: variantByBarcode.get(p.barcode) ?? null,
          barcode: p.barcode,
          stockCode: p.stockCode,
          productTitle: p.productTitle,
          category: p.category,
          brand: p.brand,
          stock: p.stock,
          currentPrice: p.currentPrice,
          currentCommissionPct: p.currentCommissionPct,
          bands: bandsForPeriod(p.brackets, period.pick(p)),
        }));
        await tx.commissionTariffItem.createMany({ data: itemsData });
        items += itemsData.length;
      }
      return { tariffId: tariff.id, itemCount: items };
    });

    return {
      tariffId,
      productCount: parsed.length,
      periodCount: periods.length,
      itemCount,
      matched,
      unmatched: parsed.length - matched,
      skippedRows,
    };
  } catch (err) {
    mapPrismaError(err);
  }
}
