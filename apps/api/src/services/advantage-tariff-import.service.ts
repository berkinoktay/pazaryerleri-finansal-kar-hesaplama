// Import service for Trendyol's "Avantajlı Ürün Etiketleri" (Yıldızlı Ürün
// Etiketleri) Excel.
//
// Simpler than the commission import and unlike Plus it has NO period dates and
// NO commission percentages: just three star-tier price thresholds per product.
// We read the raw grid via `readWorkbookGrid`, resolve every column by header
// name via `resolveAdvantageTariffLayout`, and persist one tariff plus one item
// per product row, joining barcode → ProductVariant. The raw file is kept for
// verbatim export. The reduced commission per tier is looked up from the seller's
// Commission Tariff at compute time (see advantage-tariff-compute.service.ts).

import { prisma } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';
import { readWorkbookGrid, SpreadsheetFileError, type SheetData } from '@pazarsync/spreadsheet';

import { ValidationError } from '../lib/errors';
import { cellDecimalString, cellInt, cellText } from '../lib/xlsx-grid-cells';
import {
  resolveAdvantageTariffLayout,
  type AdvantageTariffLayout,
} from './advantage-tariff-layout';

const SHEET_NAME = 'YıldızlıÜrünEtiketleri';

interface ParsedAdvantageRow {
  barcode: string;
  stockCode: string | null;
  productTitle: string;
  category: string | null;
  brand: string | null;
  size: string | null;
  modelCode: string | null;
  stock: number | null;
  currentPrice: string;
  customerPrice: string;
  hasCommissionTariff: boolean;
  // Persisted star-tier JSON: a clean `Record<string, string>` array (null
  // lowerLimit OMITTED, not stored as JSON null) — `parseStarTiers` reads an
  // absent lowerLimit back as null. Mirrors the commission tariff's `bands`.
  starTiers: Record<string, string>[];
  applyUntilEnd: boolean;
  externalId: string | null;
  tariffGroup: string | null;
}

/** Turkish yes-ish cell text ("Var", "Evet") → boolean; anything else is false. */
function cellIsYes(row: readonly unknown[], idx: number, yes: string): boolean {
  if (idx < 0) return false;
  const text = cellText(row, idx);
  return text !== null && text.trim().toLocaleLowerCase('tr') === yes;
}

function buildStarTiers(
  row: readonly unknown[],
  layout: AdvantageTariffLayout,
): Record<string, string>[] {
  const defs: ReadonlyArray<{ key: string; upper: number; lower: number }> = [
    { key: 'tier1', upper: layout.tier1Upper, lower: layout.tier1Lower },
    { key: 'tier2', upper: layout.tier2Upper, lower: layout.tier2Lower },
    { key: 'tier3', upper: layout.tier3Upper, lower: -1 },
  ];
  const tiers: Record<string, string>[] = [];
  for (const def of defs) {
    const upperLimit = cellDecimalString(row, def.upper);
    if (upperLimit === null) continue; // missing tier → skip (row still kept)
    const json: Record<string, string> = { key: def.key, upperLimit };
    const lowerLimit = def.lower >= 0 ? cellDecimalString(row, def.lower) : null;
    if (lowerLimit !== null) json.lowerLimit = lowerLimit;
    tiers.push(json);
  }
  return tiers;
}

function parseRow(
  row: readonly unknown[],
  layout: AdvantageTariffLayout,
): ParsedAdvantageRow | null {
  const barcode = cellText(row, layout.barcode);
  if (barcode === null) return null;
  const currentPrice = cellDecimalString(row, layout.currentPrice);
  if (currentPrice === null) return null;
  return {
    barcode,
    stockCode: layout.modelCode >= 0 ? cellText(row, layout.modelCode) : null,
    productTitle: (layout.productTitle >= 0 ? cellText(row, layout.productTitle) : null) ?? barcode,
    category: layout.category >= 0 ? cellText(row, layout.category) : null,
    brand: layout.brand >= 0 ? cellText(row, layout.brand) : null,
    size: layout.size >= 0 ? cellText(row, layout.size) : null,
    modelCode: layout.modelCode >= 0 ? cellText(row, layout.modelCode) : null,
    stock: layout.stock >= 0 ? cellInt(row, layout.stock) : null,
    currentPrice,
    customerPrice:
      (layout.customerPrice >= 0 ? cellDecimalString(row, layout.customerPrice) : null) ??
      currentPrice,
    hasCommissionTariff: cellIsYes(row, layout.commissionTariffFlag, 'var'),
    starTiers: buildStarTiers(row, layout),
    applyUntilEnd: cellIsYes(row, layout.applyUntilEnd, 'evet'),
    externalId: layout.externalId >= 0 ? cellText(row, layout.externalId) : null,
    tariffGroup: layout.tariffGroup >= 0 ? cellText(row, layout.tariffGroup) : null,
  };
}

// ─── Entry point ────────────────────────────────────────────────────────────

export interface ImportAdvantageTariffInput {
  organizationId: string;
  storeId: string;
  file: Buffer;
  filename: string;
  createdBy: string | null;
  name?: string;
  /** The commission tariff (week) whose bands supply the reduced commission; null = category. */
  commissionSourceTariffId?: string | null;
}

export interface ImportAdvantageTariffResult {
  tariffId: string;
  productCount: number;
  itemCount: number;
  matched: number;
  unmatched: number;
  skippedRows: number;
}

function deriveName(input: ImportAdvantageTariffInput): string {
  const explicit = input.name?.trim();
  if (explicit !== undefined && explicit !== '') return explicit;
  const stem = input.filename.replace(/\.[^.]+$/, '').trim();
  if (stem !== '') return stem;
  return 'Avantajlı Ürün Etiketleri';
}

export async function importAdvantageTariff(
  input: ImportAdvantageTariffInput,
): Promise<ImportAdvantageTariffResult> {
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
  const layout = resolveAdvantageTariffLayout(grid[0] ?? []);
  if (layout === null) {
    throw new ValidationError([{ field: 'file', code: 'INVALID_ADVANTAGE_TARIFF_FORMAT' }]);
  }

  const parsed: ParsedAdvantageRow[] = [];
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

  // Match barcode → variant (store-scoped).
  const barcodes = [...new Set(parsed.map((p) => p.barcode))];
  const variants = await prisma.productVariant.findMany({
    where: { organizationId, storeId, barcode: { in: barcodes } },
    select: { id: true, barcode: true },
  });
  const variantByBarcode = new Map(variants.map((v) => [v.barcode, v.id]));
  const matched = parsed.filter((p) => variantByBarcode.has(p.barcode)).length;

  // The seller picks which commission tariff (week) this advantage belongs to at
  // upload; empty = category commission. Validate it belongs to this store.
  const rawSource = input.commissionSourceTariffId?.trim();
  const commissionSourceTariffId = rawSource !== undefined && rawSource !== '' ? rawSource : null;
  if (commissionSourceTariffId !== null) {
    const source = await prisma.commissionTariff.findFirst({
      where: { id: commissionSourceTariffId, organizationId, storeId },
      select: { id: true },
    });
    if (source === null) {
      throw new ValidationError([
        { field: 'commissionSourceTariffId', code: 'INVALID_COMMISSION_SOURCE' },
      ]);
    }
  }

  const name = deriveName(input);

  try {
    const { tariffId, itemCount } = await prisma.$transaction(async (tx) => {
      const tariff = await tx.advantageTariff.create({
        data: {
          organizationId,
          storeId,
          name,
          sourceFilename: input.filename,
          sourceFile: new Uint8Array(input.file),
          commissionSourceTariffId,
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
        customerPrice: p.customerPrice,
        hasCommissionTariff: p.hasCommissionTariff,
        starTiers: p.starTiers,
        applyUntilEnd: p.applyUntilEnd,
        externalId: p.externalId,
        tariffGroup: p.tariffGroup,
        sortOrder: index,
      }));
      await tx.advantageTariffItem.createMany({ data: itemsData });
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
