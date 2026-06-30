// Import service for Trendyol's "Ürün Komisyon Tarifeleri" Excel.
//
// The export is a fixed-IDENTITY but variable-WIDTH sheet: columns A-N (product
// identity + the 4 price brackets) are stable, but the GÜNCEL TSF / YENİ TSF /
// Tarife Seçimi tail columns shift by how many "Tarih aralığı (N Gün)" period
// blocks the file carries (1 period → 27 cols, 2 periods → 35). Its commission
// headers ("1.KOMİSYON"..) also repeat per period, so header matching cannot
// disambiguate them. We read the raw grid via `readWorkbookGrid` (which also
// fixes Trendyol's bogus single-cell <dimension>) and resolve every column from
// the header via `resolveTariffLayout`, then map by the resolved positions.
//
// Each band is a PRICE RANGE [lower, upper] (shared across periods); each present
// period contributes its own commission set. We keep the raw file (for export to
// patch verbatim) and persist one period row per present period and one item per
// (product × period), joining barcode → ProductVariant. Profit is computed on read.

import { prisma } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';
import { readWorkbookGrid, SpreadsheetFileError, type SheetData } from '@pazarsync/spreadsheet';

import { ValidationError } from '../lib/errors';
import { parseTariffPeriodLabel } from './commission-tariff.types';
import { resolveTariffLayout, type TariffLayout } from './commission-tariff-layout';

const SHEET_NAME = 'KomisyonTarifeleriÜrünleri';

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
  // Commissions per layout period (parallel to layout.periods): [periodIdx][band].
  periodComms: ReadonlyArray<ReadonlyArray<string | null>>;
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

function parseRow(row: readonly unknown[], layout: TariffLayout): ParsedRow | null {
  const { fixed } = layout;
  const barcode = cellText(row, fixed.barcode);
  if (barcode === null) return null;
  return {
    barcode,
    stockCode: cellText(row, fixed.modelCode) ?? cellText(row, fixed.sellerStockCode),
    productTitle: cellText(row, fixed.productTitle) ?? barcode,
    category: cellText(row, fixed.category),
    brand: cellText(row, fixed.brand),
    stock: cellInt(row, fixed.stock),
    currentPrice: cellDecimalString(row, layout.currentPrice) ?? '0',
    currentCommissionPct: cellDecimalString(row, layout.currentCommission) ?? '0',
    brackets: {
      band1Lower: cellDecimalString(row, fixed.band1Lower),
      band2Lower: cellDecimalString(row, fixed.band2Lower),
      band2Upper: cellDecimalString(row, fixed.band2Upper),
      band3Lower: cellDecimalString(row, fixed.band3Lower),
      band3Upper: cellDecimalString(row, fixed.band3Upper),
      band4Upper: cellDecimalString(row, fixed.band4Upper),
    },
    periodComms: layout.periods.map((p) => p.commCols.map((c) => cellDecimalString(row, c))),
  };
}

interface PresentPeriod {
  label: string;
  dayCount: number;
  startsAt: Date | null;
  endsAt: Date | null;
  sortOrder: number;
  layoutIndex: number;
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
  const layout = resolveTariffLayout(grid[0] ?? []);
  if (layout === null) {
    throw new ValidationError([{ field: 'file', code: 'INVALID_TARIFF_FORMAT' }]);
  }

  const parsed: ParsedRow[] = [];
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

  // A period block can exist in the header but carry no data (empty columns), so
  // keep only periods whose date label is filled on the first row.
  const firstRow = grid[1] ?? [];
  const year = input.now.getUTCFullYear();
  const present: PresentPeriod[] = [];
  layout.periods.forEach((period, layoutIndex) => {
    const label = cellText(firstRow, period.labelCol);
    if (label === null) return;
    const { startsAt, endsAt } = parseTariffPeriodLabel(label, year);
    present.push({
      label,
      dayCount: period.dayCount,
      startsAt,
      endsAt,
      sortOrder: present.length,
      layoutIndex,
    });
  });
  if (present.length === 0) {
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

  const name = deriveName(input, present[0]?.label ?? null);

  try {
    const { tariffId, itemCount } = await prisma.$transaction(async (tx) => {
      const tariff = await tx.commissionTariff.create({
        data: {
          organizationId,
          storeId,
          name,
          sourceFilename: input.filename,
          sourceFile: new Uint8Array(input.file),
          createdBy: input.createdBy,
        },
      });

      let items = 0;
      for (const period of present) {
        const periodRow = await tx.commissionTariffPeriod.create({
          data: {
            organizationId,
            storeId,
            tariffId: tariff.id,
            dateRangeLabel: period.label,
            dayCount: period.dayCount,
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
          bands: bandsForPeriod(p.brackets, p.periodComms[period.layoutIndex] ?? []),
        }));
        await tx.commissionTariffItem.createMany({ data: itemsData });
        items += itemsData.length;
      }
      return { tariffId: tariff.id, itemCount: items };
    });

    return {
      tariffId,
      productCount: parsed.length,
      periodCount: present.length,
      itemCount,
      matched,
      unmatched: parsed.length - matched,
      skippedRows,
    };
  } catch (err) {
    mapPrismaError(err);
  }
}
