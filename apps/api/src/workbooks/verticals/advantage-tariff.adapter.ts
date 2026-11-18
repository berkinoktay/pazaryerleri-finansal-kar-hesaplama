// The advantage tariff page on the generic workbook pipeline. The file lists the
// products that can earn a star label, each with three price tiers; every product row
// is stored as one item, in sheet order, and starts without a choice. The upload may
// name the commission tariff (week) whose bands supply the reduced commission; it must
// belong to the same store. The export writes each chosen price (the seller's own, else
// the chosen tier's upper limit) into the new sale price column of every row that
// carries the product's barcode.

import { Decimal } from 'decimal.js';

import { prisma, type Prisma } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';

import { ValidationError, type ValidationIssue } from '../../lib/errors';
import { isForeignKeyViolationOn } from '../../lib/map-transaction-error';
import { parseStarTiers } from '../../services/advantage-tariff.types';
import {
  AdvantageTariffIdPathSchema,
  AdvantageTariffStorePathSchema,
  ImportAdvantageTariffFormSchema,
  ImportAdvantageTariffResponseSchema,
  type ImportAdvantageTariffResponse,
} from '../../validators/advantage-tariff.validator';
import type {
  CellWrite,
  ExportSource,
  InspectContext,
  StoreScope,
  WorkbookHttpSpec,
  WorkbookVerticalAdapter,
  WriteContext,
} from '../adapter';
import { XLSX_MIME } from '../download';
import {
  ADVANTAGE_PRICE_SCALE,
  trendyolAdvantageTariffFormat,
  type AdvantageTariffRow,
  type AdvantageTariffWriteKey,
} from '../formats/trendyol/advantage-tariff.format';
import type { trendyolAdvantageTariffLayout } from '../formats/trendyol/advantage-tariff.layout';
import { createManyChunked } from '../import-rows';

/** What the export reads of one advantage item. */
export interface AdvantageTariffExportItem {
  readonly barcode: string;
  readonly selectedTier: string | null;
  readonly customPrice: Prisma.Decimal | null;
  readonly starTiers: Prisma.JsonValue;
}

/** The upload form's own field: the commission tariff (week) the reduced commission is read from. */
export interface AdvantageTariffImportConfig {
  /** Null reads the category commission. */
  readonly commissionSourceTariffId: string | null;
}

/** The field and code of a commission source the store does not hold. */
const INVALID_COMMISSION_SOURCE_ISSUE: Readonly<ValidationIssue> = {
  field: 'commissionSourceTariffId',
  code: 'INVALID_COMMISSION_SOURCE',
};

/** The foreign key of `advantage_tariffs.commission_source_tariff_id`. */
const COMMISSION_SOURCE_FOREIGN_KEY = {
  constraint: 'advantage_tariffs_commission_source_tariff_id_fkey',
  column: 'commission_source_tariff_id',
} as const;

const ADVANTAGE_TARIFF_HTTP: WorkbookHttpSpec = {
  segment: 'advantage-tariffs',
  idParam: 'tariffId',
  tag: 'AdvantageTariffs',
  storePathSchema: AdvantageTariffStorePathSchema,
  itemPathSchema: AdvantageTariffIdPathSchema,
  importSummary: 'Import a Trendyol Advantage product-label Excel',
  importDescription:
    "Uploads Trendyol's Avantajlı Ürün Etiketleri .xlsx (multipart `file`). Every column is resolved " +
    'by header name; unlike the commission/Plus exports this file carries NO commission and NO dates. ' +
    "Each product row exposes three star tiers whose reduced commission is READ from the store's " +
    'Commission Tariff at compute time, and is joined to a ProductVariant by barcode. Stores one ' +
    'tariff with its product rows; profit is computed later on read. Returns counts: products, items, ' +
    'matched/unmatched products, skipped rows. Rejects a file whose header layout does not match the ' +
    'expected Advantage export (422 VALIDATION_ERROR).',
  importCreated: 'Tariff imported',
  import422: 'File missing, unreadable, or not the expected tariff format',
  exportSummary: 'Export the Advantage tariff as a re-uploadable Trendyol Excel',
  exportDescription:
    "Returns Trendyol's ORIGINAL uploaded file with the seller's chosen tier price patched into the " +
    '"YENİ TSF" column for every product that has a selected tier. Every other cell is byte-for-byte ' +
    'unchanged, so the file can be re-uploaded to Trendyol verbatim. Marks the tariff exported. ' +
    'Returns 409 if the tariff has no stored source file (or it is unreadable / lacks the writable ' +
    'column).',
  exportOk: 'The patched .xlsx, ready to re-upload to Trendyol',
  export404: 'Tariff or store not found in this organization',
  export409: 'Tariff has no stored source file to export',
  exportMimes: [XLSX_MIME],
};

/**
 * The seller's chosen new sale price of one item, or null when it carries none: the
 * custom price, else the selected tier's upper limit (the highest price that still earns
 * that label), both with two decimal places. The custom price is checked first: a
 * confirmed custom price is stored without a tier, and a row with both writes the custom
 * one. A selected tier the stored tiers do not hold carries no price.
 */
export function resolveAdvantageExportPrice(
  item: Pick<AdvantageTariffExportItem, 'selectedTier' | 'customPrice' | 'starTiers'>,
): string | null {
  if (item.customPrice !== null) return item.customPrice.toFixed(ADVANTAGE_PRICE_SCALE);
  if (item.selectedTier === null) return null;
  const tier = parseStarTiers(item.starTiers).find(
    (candidate) => candidate.key === item.selectedTier,
  );
  return tier === undefined ? null : new Decimal(tier.upperLimit).toFixed(ADVANTAGE_PRICE_SCALE);
}

/** The form's commission source: a blank value names none. */
function commissionSourceOf(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  return trimmed === undefined || trimmed === '' ? null : trimmed;
}

/**
 * Refuses a commission source the store does not hold, looked up with the store record's
 * scope: another organization's tariff, or a sibling store's, is a field error. No source
 * reads nothing.
 */
async function inspectCommissionSource({
  scope,
  config,
}: InspectContext<
  typeof trendyolAdvantageTariffLayout,
  AdvantageTariffRow,
  AdvantageTariffImportConfig
>): Promise<undefined> {
  const id = config.commissionSourceTariffId;
  if (id === null) return undefined;
  let source;
  try {
    source = await prisma.commissionTariff.findFirst({
      where: { id, organizationId: scope.organizationId, storeId: scope.storeId },
      select: { id: true },
    });
  } catch (err) {
    mapPrismaError(err);
  }
  if (source === null) throw new ValidationError([{ ...INVALID_COMMISSION_SOURCE_ISSUE }]);
  return undefined;
}

/**
 * The tariff and its items, one group; null when it is not in the scope. The items come
 * in sortOrder, then barcode and id, so the last priced item of a repeated barcode is
 * always the same one.
 */
async function loadAdvantageTariff(
  { organizationId, storeId }: StoreScope,
  id: string,
): Promise<ExportSource<AdvantageTariffExportItem> | null> {
  let tariff;
  try {
    tariff = await prisma.advantageTariff.findFirst({
      where: { id, organizationId, storeId },
      select: {
        name: true,
        sourceFile: true,
        sourceFilename: true,
        sourceFormatId: true,
        items: {
          orderBy: [{ sortOrder: 'asc' }, { barcode: 'asc' }, { id: 'asc' }],
          select: { barcode: true, selectedTier: true, customPrice: true, starTiers: true },
        },
      },
    });
  } catch (err) {
    mapPrismaError(err);
  }
  if (tariff === null) return null;
  return {
    name: tariff.name,
    sourceFile: tariff.sourceFile,
    sourceFilename: tariff.sourceFilename,
    sourceFormatId: tariff.sourceFormatId,
    groups: [{ tag: null, items: tariff.items }],
  };
}

/** The new sale price cell of a row whose barcode carries a price (the pick); else nothing. */
function advantageWriteBack(
  ctx: WriteContext<AdvantageTariffExportItem, AdvantageTariffWriteKey>,
): readonly CellWrite<AdvantageTariffWriteKey>[] {
  return ctx.pick === null ? [] : [{ key: 'newTsf', value: ctx.pick }];
}

export const advantageTariffAdapter: WorkbookVerticalAdapter<
  typeof trendyolAdvantageTariffLayout,
  AdvantageTariffRow,
  AdvantageTariffImportConfig,
  undefined,
  AdvantageTariffExportItem,
  ImportAdvantageTariffResponse,
  AdvantageTariffWriteKey
> = {
  page: trendyolAdvantageTariffFormat.page,
  parentTable: 'advantage_tariffs',
  countLists: (tx, { organizationId, storeId }) =>
    tx.advantageTariff.count({ where: { organizationId, storeId } }),
  align: 'anchor-map',
  http: ADVANTAGE_TARIFF_HTTP,
  formSchema: ImportAdvantageTariffFormSchema,
  responseSchema: ImportAdvantageTariffResponseSchema,
  readForm: (form) => {
    const { file, name, commissionSourceTariffId } = ImportAdvantageTariffFormSchema.parse(form);
    return {
      file,
      name,
      config: { commissionSourceTariffId: commissionSourceOf(commissionSourceTariffId) },
    };
  },
  formats: [trendyolAdvantageTariffFormat],
  inspect: inspectCommissionSource,
  nameFallback: () => null,
  persist: async (tx, { parent, rows, variantIdByAnchor, config }) => {
    let tariff;
    try {
      tariff = await tx.advantageTariff.create({
        data: {
          organizationId: parent.organizationId,
          storeId: parent.storeId,
          name: parent.name,
          sourceFilename: parent.sourceFilename,
          sourceFile: parent.sourceFile,
          sourceFormatId: parent.sourceFormatId,
          commissionSourceTariffId: config.commissionSourceTariffId,
          createdBy: parent.createdBy,
        },
        select: { id: true },
      });
    } catch (err) {
      // `inspect` checked the source before the transaction; a delete in between fails
      // this insert, and the seller gets the same field error as when the source was
      // already gone. The transaction rolls back, nothing is stored.
      if (isForeignKeyViolationOn(err, COMMISSION_SOURCE_FOREIGN_KEY)) {
        throw new ValidationError([{ ...INVALID_COMMISSION_SOURCE_ISSUE }]);
      }
      throw err;
    }
    // One item per product row, in sheet order; no choice is read from the file.
    const items = rows.map((row, index) => ({
      organizationId: parent.organizationId,
      storeId: parent.storeId,
      tariffId: tariff.id,
      productVariantId: variantIdByAnchor.get(row.anchor) ?? null,
      barcode: row.data.barcode,
      stockCode: row.data.stockCode,
      productTitle: row.data.productTitle,
      category: row.data.category,
      brand: row.data.brand,
      size: row.data.size,
      modelCode: row.data.modelCode,
      stock: row.data.stock,
      currentPrice: row.data.currentPrice,
      customerPrice: row.data.customerPrice,
      hasCommissionTariff: row.data.hasCommissionTariff,
      starTiers: row.data.starTiers,
      applyUntilEnd: row.data.applyUntilEnd,
      externalId: row.data.externalId,
      tariffGroup: row.data.tariffGroup,
      sortOrder: index,
    }));
    await createManyChunked(items, (chunk) => tx.advantageTariffItem.createMany({ data: chunk }));
    return { parentId: tariff.id, itemCount: items.length };
  },
  rejectionForUniqueViolation: () => null,
  toResponse: (outcome) => ({
    tariffId: outcome.parentId,
    productCount: outcome.rowCount,
    itemCount: outcome.itemCount,
    matched: outcome.matchedRows,
    unmatched: outcome.rowCount - outcome.matchedRows,
    skippedRows: outcome.skippedRows,
    prefilledRows: outcome.prefilledRows,
  }),
  load: loadAdvantageTariff,
  notFoundResource: 'AdvantageTariff',
  files: 'single',
  anchorOf: (item) => item.barcode,
  // Only an item with a price enters the anchor map, so an unpriced duplicate never
  // shadows an earlier priced one.
  pick: resolveAdvantageExportPrice,
  resolveWriteBack: advantageWriteBack,
  touchExported: ({ organizationId, storeId }, id) =>
    prisma.advantageTariff.updateMany({
      where: { id, organizationId, storeId },
      data: { exportedAt: new Date() },
    }),
};
