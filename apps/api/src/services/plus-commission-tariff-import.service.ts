// Import service for Trendyol's "Plus Komisyon" Excel.
//
// Mirrors the product commission import: the Plus sheet is fixed-IDENTITY but
// variable-WIDTH — columns for identity + current pricing + the shared Plus price
// ceiling / commission base are stable, but a single upload can carry MULTIPLE
// "Tarih Aralığı (N Gün)" period blocks, each followed by its own "Plus Komisyon
// Teklifi" offer percent. Its offer header repeats per period, so header matching
// cannot disambiguate them — we read the raw grid via `readWorkbookGrid` and
// resolve every column from the header via `resolvePlusTariffLayout`, then map by
// the resolved positions.
//
// We keep the raw file (for export to patch verbatim) and persist one period row
// per present period and one item per (product × period), joining barcode ->
// ProductVariant. Each item carries that period's Plus offer percent. Profit under
// Plus is computed on read; commission percents are stored verbatim ("19", "15.4")
// — the engine's commission rate IS a percent.

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
  plusCommissionBasePrice: string;
  externalId: string | null;
  tariffGroup: string | null;
  cancelled: boolean;
  // Plus offer percent per layout period (parallel to layout.periods).
  periodOffers: ReadonlyArray<string>;
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
    plusCommissionBasePrice:
      (layout.plusCommissionBasePrice >= 0
        ? cellDecimalString(row, layout.plusCommissionBasePrice)
        : null) ??
      cellDecimalString(row, layout.plusPriceUpperLimit) ??
      '0',
    externalId: layout.externalId >= 0 ? cellText(row, layout.externalId) : null,
    tariffGroup: layout.tariffGroup >= 0 ? cellText(row, layout.tariffGroup) : null,
    cancelled: layout.cancelled >= 0 ? (cellInt(row, layout.cancelled) ?? 0) !== 0 : false,
    periodOffers: layout.periods.map((p) => cellDecimalString(row, p.offerCol) ?? '0'),
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
  periodCount: number;
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

  // A period block can exist in the header but carry no data (empty label column),
  // so keep only periods whose date label is filled on the first row.
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

  // The tariff's week window = earliest start … latest end across its periods.
  const startTimes = present
    .map((p) => p.startsAt)
    .filter((d): d is Date => d !== null)
    .map((d) => d.getTime());
  const endTimes = present
    .map((p) => p.endsAt)
    .filter((d): d is Date => d !== null)
    .map((d) => d.getTime());
  const weekStartsAt = startTimes.length > 0 ? new Date(Math.min(...startTimes)) : null;
  const weekEndsAt = endTimes.length > 0 ? new Date(Math.max(...endTimes)) : null;

  // One Plus tariff per week per store — reject a new tariff whose date range
  // OVERLAPS any existing one (not just an exact-start match). Two ranges overlap
  // iff existing.start < new.end AND existing.end > new.start. Back-to-back weeks
  // touch at a 1-minute gap (…07.59 vs …08.00) so they do NOT overlap → allowed.
  // Only enforced when both bounds are known; unparseable dates fall through.
  // Surfaced through the file-error channel so the upload dialog shows a message.
  if (weekStartsAt !== null && weekEndsAt !== null) {
    const overlapping = await prisma.plusCommissionTariff.findFirst({
      where: {
        organizationId,
        storeId,
        weekStartsAt: { lt: weekEndsAt },
        weekEndsAt: { gt: weekStartsAt },
      },
      select: { id: true },
    });
    if (overlapping !== null) {
      throw new ValidationError([{ field: 'file', code: 'DUPLICATE_TARIFF_WEEK' }]);
    }
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
      const tariff = await tx.plusCommissionTariff.create({
        data: {
          organizationId,
          storeId,
          name,
          sourceFilename: input.filename,
          sourceFile: new Uint8Array(input.file),
          weekStartsAt,
          weekEndsAt,
          createdBy: input.createdBy,
        },
      });

      let items = 0;
      for (const period of present) {
        const periodRow = await tx.plusCommissionTariffPeriod.create({
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
        const itemsData = parsed.map((p, index) => ({
          organizationId,
          storeId,
          periodId: periodRow.id,
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
          // This period's Plus offer percent (each period carries its own).
          plusCommissionPct: p.periodOffers[period.layoutIndex] ?? '0',
          plusCommissionBasePrice: p.plusCommissionBasePrice,
          externalId: p.externalId,
          tariffGroup: p.tariffGroup,
          cancelled: p.cancelled,
          // Excel row order (`parsed` is built top-to-bottom); every period reuses the
          // same order so the detail lists products as in the file, identically per tab.
          sortOrder: index,
        }));
        await tx.plusCommissionTariffItem.createMany({ data: itemsData });
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
