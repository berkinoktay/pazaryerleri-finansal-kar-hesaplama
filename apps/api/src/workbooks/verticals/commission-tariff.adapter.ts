// The commission tariff page on the generic workbook pipeline. The file is one week of
// Trendyol's product commission tariffs: one row per product with its four price
// brackets, one block per period of the week with that period's band commissions. The
// periods whose label is filled on the first row are stored, each with one item per
// product row in sheet order carrying that period's bands, starting without a choice;
// one tariff per week and store (an upload whose week overlaps a stored one is refused,
// before the import transaction and again inside it), and the import queues a profit
// recompute for the orders of the barcodes it covers. The export writes each chosen
// product's price and the window's tariff selection into every row that carries its
// barcode, one file per window.

import { Decimal } from 'decimal.js';

import { prisma, type Prisma } from '@pazarsync/db';
import { ProfitRecomputeReason } from '@pazarsync/db/enums';
import {
  bandPrice,
  enqueueProfitRecomputeForBarcodes,
  parseStoredTariffBands,
} from '@pazarsync/profit';
import { mapPrismaError } from '@pazarsync/sync-core';

import { NotFoundError } from '../../lib/errors';
import { isUniqueViolationOn } from '../../lib/map-transaction-error';
import {
  ImportTariffFormSchema,
  ImportTariffResponseSchema,
  TariffIdPathSchema,
  TariffStorePathSchema,
  type ImportTariffResponse,
} from '../../validators/commission-tariff.validator';
import type {
  CellWrite,
  ExportSource,
  InspectContext,
  StoreScope,
  WorkbookHttpSpec,
  WorkbookVerticalAdapter,
  WriteContext,
} from '../adapter';
import { XLSX_MIME, ZIP_MIME } from '../download';
import {
  bandsForPeriod,
  NEW_TSF_SCALE,
  trendyolCommissionTariffFormat,
  type CommissionTariffRow,
  type CommissionTariffWriteKey,
} from '../formats/trendyol/commission-tariff.format';
import type { trendyolCommissionTariffLayout } from '../formats/trendyol/commission-tariff.layout';
import { tariffSelectionLabel } from '../formats/trendyol/labels';
import { TARIFF_SELECTION_WRITE } from '../formats/trendyol/tariff-window';
import { importWorkbook } from '../import-workbook';
import { createManyChunked } from '../import-rows';
import {
  assertNoOverlappingWeek,
  inspectUploadWeek,
  WEEK_UNIQUE_COLUMN,
  type TariffWeek,
} from '../tariff-week';
import { WorkbookInvariantError } from '../workbook-errors';

/** What the export reads of one commission tariff item. */
export interface CommissionTariffExportItem {
  readonly barcode: string;
  readonly selectedBand: string | null;
  readonly customPrice: Prisma.Decimal | null;
  readonly currentPrice: Prisma.Decimal;
  readonly bands: Prisma.JsonValue;
}

const COMMISSION_TARIFF_HTTP: WorkbookHttpSpec = {
  segment: 'commission-tariffs',
  idParam: 'tariffId',
  tag: 'CommissionTariffs',
  storePathSchema: TariffStorePathSchema,
  itemPathSchema: TariffIdPathSchema,
  importSummary: 'Import a Trendyol commission-tariff Excel',
  importDescription:
    "Uploads Trendyol's 'Ürün Komisyon Tarifeleri' .xlsx (multipart `file`). The fixed-layout " +
    'sheet is read by position (its commission columns share duplicate headers), each present ' +
    'period (3-day / 4-day) becomes a period, and each product row is joined to a ProductVariant ' +
    'by barcode. Stores one tariff with its periods + product rows; profit is computed later on ' +
    'read. Returns counts: products, periods, items, matched/unmatched products, skipped rows. ' +
    'Rejects a file whose header layout does not match the expected export (422 VALIDATION_ERROR).',
  importCreated: 'Tariff imported',
  import422: 'File missing, unreadable, or not the expected tariff format',
  exportSummary: 'Export the tariff as a re-uploadable Trendyol Excel',
  exportDescription:
    "Returns Trendyol's ORIGINAL uploaded file with the seller's choices patched in: the chosen " +
    'band price into "YENİ TSF (FİYAT GÜNCELLE)" and "{N} Günlük Fiyat" into "Tarife Seçimi" for ' +
    'every product that has a selection. Every other cell is byte-for-byte unchanged, so the file ' +
    'can be re-uploaded to Trendyol verbatim. A split week yields up to three window files (a ' +
    'whole-week "7 Günlük Fiyat" file for products priced the same in both sub-periods, plus ' +
    '"3 Günlük Fiyat" / "4 Günlük Fiyat" files for period-specific prices), only the non-empty ' +
    'ones, bundled into a single .zip. Marks the tariff exported. Returns 409 if the tariff has ' +
    'no stored source file.',
  exportOk:
    'The patched .xlsx (single file), or a .zip of both window files when a product is priced ' +
    'differently across sub-periods, ready to re-upload to Trendyol',
  export404: 'Tariff or store not found in this organization',
  export409: 'Tariff has no stored source file to export',
  exportMimes: [XLSX_MIME, ZIP_MIME],
};

/**
 * The price of one item, or null when it carries none: an item without a selected band
 * carries no price, whatever its custom price. A selected item writes its custom price,
 * else the price of its selected stored band (`bandPrice`: the band's upper limit, else
 * its lower limit, else the current price), else, when the stored bands do not hold the
 * selected key, its current price; always with two decimal places.
 */
export function resolveCommissionExportPrice(
  item: Pick<CommissionTariffExportItem, 'selectedBand' | 'customPrice' | 'currentPrice' | 'bands'>,
): string | null {
  if (item.selectedBand === null) return null;
  if (item.customPrice !== null) return item.customPrice.toFixed(NEW_TSF_SCALE);
  const band = parseStoredTariffBands(item.bands).find(
    (stored) => stored.key === item.selectedBand,
  );
  if (band === undefined) return item.currentPrice.toFixed(NEW_TSF_SCALE);
  return bandPrice(band, new Decimal(item.currentPrice.toString())).toFixed(NEW_TSF_SCALE);
}

/**
 * The week of the upload (`inspectUploadWeek`): the period blocks filled on the first
 * data row, checked as the export writes them, then the scoped overlap query.
 */
async function inspectTariffWeek({
  scope,
  now,
  firstDataRow,
}: InspectContext<
  typeof trendyolCommissionTariffLayout,
  CommissionTariffRow,
  undefined
>): Promise<TariffWeek> {
  return inspectUploadWeek({
    table: prisma.commissionTariff,
    scope,
    now,
    firstRowPeriods:
      firstDataRow === null
        ? []
        : firstDataRow.blocks('periods').map((period) => ({
            tag: period.tag,
            label: period.text('label'),
          })),
    write: { spec: TARIFF_SELECTION_WRITE, label: tariffSelectionLabel },
  });
}

/**
 * The tariff, its periods in sort order (one group each, tagged with the period's day
 * count) and each period's items in sortOrder, then barcode and id, so the last selected
 * item of a repeated barcode is always the same one; null when it is not in the scope.
 */
async function loadCommissionTariff(
  { organizationId, storeId }: StoreScope,
  id: string,
): Promise<ExportSource<CommissionTariffExportItem> | null> {
  let tariff;
  try {
    tariff = await prisma.commissionTariff.findFirst({
      where: { id, organizationId, storeId },
      select: {
        name: true,
        sourceFile: true,
        sourceFilename: true,
        sourceFormatId: true,
        periods: {
          orderBy: { sortOrder: 'asc' },
          select: {
            dayCount: true,
            items: {
              orderBy: [{ sortOrder: 'asc' }, { barcode: 'asc' }, { id: 'asc' }],
              select: {
                barcode: true,
                selectedBand: true,
                customPrice: true,
                currentPrice: true,
                bands: true,
              },
            },
          },
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
    groups: tariff.periods.map((period) => ({ tag: period.dayCount, items: period.items })),
  };
}

/**
 * The cells of a row whose barcode carries a price (it has a pick): the price and the
 * window's tariff selection. A row without a pick writes nothing.
 */
function commissionWriteBack(
  ctx: WriteContext<CommissionTariffExportItem, CommissionTariffWriteKey>,
): readonly CellWrite<CommissionTariffWriteKey>[] {
  if (ctx.pick === null) return [];
  if (ctx.window === null) {
    throw new WorkbookInvariantError('A commission tariff row is written into a period window');
  }
  return [
    { key: 'newTsf', value: ctx.pick },
    { key: 'tariffSelection', value: ctx.window.label },
  ];
}

export const commissionTariffAdapter: WorkbookVerticalAdapter<
  typeof trendyolCommissionTariffLayout,
  CommissionTariffRow,
  undefined,
  TariffWeek,
  CommissionTariffExportItem,
  ImportTariffResponse,
  CommissionTariffWriteKey
> = {
  page: trendyolCommissionTariffFormat.page,
  parentTable: 'commission_tariffs',
  countLists: (tx, { organizationId, storeId }) =>
    tx.commissionTariff.count({ where: { organizationId, storeId } }),
  align: 'anchor-map',
  http: COMMISSION_TARIFF_HTTP,
  formSchema: ImportTariffFormSchema,
  responseSchema: ImportTariffResponseSchema,
  readForm: (form) => {
    const { file, name } = ImportTariffFormSchema.parse(form);
    return { file, name, config: undefined };
  },
  formats: [trendyolCommissionTariffFormat],
  inspect: inspectTariffWeek,
  nameFallback: (week) => week.present[0]?.label ?? null,
  persist: async (tx, { parent, rows, variantIdByAnchor, distinctAnchors, meta: week }) => {
    const scope: StoreScope = { organizationId: parent.organizationId, storeId: parent.storeId };
    await assertNoOverlappingWeek(tx.commissionTariff, scope, week);
    const tariff = await tx.commissionTariff.create({
      data: {
        organizationId: parent.organizationId,
        storeId: parent.storeId,
        name: parent.name,
        sourceFilename: parent.sourceFilename,
        sourceFile: parent.sourceFile,
        sourceFormatId: parent.sourceFormatId,
        weekStartsAt: week.weekStartsAt,
        weekEndsAt: week.weekEndsAt,
        createdBy: parent.createdBy,
      },
      select: { id: true },
    });
    let itemCount = 0;
    for (const period of week.present) {
      const periodRow = await tx.commissionTariffPeriod.create({
        data: {
          organizationId: parent.organizationId,
          storeId: parent.storeId,
          tariffId: tariff.id,
          dateRangeLabel: period.label,
          dayCount: period.dayCount,
          startsAt: period.startsAt,
          endsAt: period.endsAt,
          sortOrder: period.sortOrder,
        },
        select: { id: true },
      });
      // One item per product row, in sheet order, the same order in every period; each
      // carries this period's own bands.
      const items = rows.map((row, index) => ({
        organizationId: parent.organizationId,
        storeId: parent.storeId,
        periodId: periodRow.id,
        productVariantId: variantIdByAnchor.get(row.anchor) ?? null,
        barcode: row.data.barcode,
        stockCode: row.data.stockCode,
        productTitle: row.data.productTitle,
        category: row.data.category,
        brand: row.data.brand,
        stock: row.data.stock,
        sortOrder: index,
        currentPrice: row.data.currentPrice,
        commissionBasePrice: row.data.commissionBasePrice,
        currentCommissionPct: row.data.currentCommissionPct,
        bands: bandsForPeriod(row.data.brackets, row.data.periodComms[period.layoutIndex] ?? []),
      }));
      await createManyChunked(items, (chunk) =>
        tx.commissionTariffItem.createMany({ data: chunk }),
      );
      itemCount += items.length;
    }
    // A new tariff is a backdated commission input for every order whose items carry one
    // of the imported barcodes: their commission now resolves through the tariff bands.
    // One statement scoped to the organization and the store queues them, so no other
    // tenant is touched even when another store shares a barcode.
    await enqueueProfitRecomputeForBarcodes(tx, {
      organizationId: parent.organizationId,
      storeId: parent.storeId,
      barcodes: distinctAnchors,
      reason: ProfitRecomputeReason.REFERENCE_CHANGED,
    });
    return { parentId: tariff.id, itemCount };
  },
  rejectionForUniqueViolation: (err) =>
    isUniqueViolationOn(err, WEEK_UNIQUE_COLUMN) ? 'DUPLICATE_WEEK' : null,
  toResponse: (outcome) => ({
    tariffId: outcome.parentId,
    productCount: outcome.rowCount,
    periodCount: outcome.meta.present.length,
    itemCount: outcome.itemCount,
    matched: outcome.matchedRows,
    unmatched: outcome.rowCount - outcome.matchedRows,
    skippedRows: outcome.skippedRows,
    prefilledRows: outcome.prefilledRows,
  }),
  load: loadCommissionTariff,
  notFoundResource: 'CommissionTariff',
  files: 'period-windows',
  anchorOf: (item) => item.barcode,
  // Only an item with a selected band enters the anchor map, so an unselected duplicate
  // never shadows an earlier selected one; across periods the pick is the compared price.
  pick: resolveCommissionExportPrice,
  resolveWriteBack: commissionWriteBack,
  touchExported: ({ organizationId, storeId }, id) =>
    prisma.commissionTariff.updateMany({
      where: { id, organizationId, storeId },
      data: { exportedAt: new Date() },
    }),
};

/** What `importTariff` takes: the store's ids, the uploaded file and its name, the uploader. */
export interface ImportTariffInput {
  readonly organizationId: string;
  readonly storeId: string;
  readonly file: Buffer;
  readonly filename: string;
  readonly createdBy: string | null;
  readonly name?: string;
  readonly now: Date;
}

/**
 * Imports a commission tariff file into a store without the HTTP route (services and
 * tests): the store is read with the organization's scope, and the import runs with
 * that record's ids and platform. Throws NotFoundError when the store is not in the
 * organization.
 */
export async function importTariff(input: ImportTariffInput): Promise<ImportTariffResponse> {
  let store;
  try {
    store = await prisma.store.findFirst({
      where: { id: input.storeId, organizationId: input.organizationId },
      select: { id: true, organizationId: true, platform: true },
    });
  } catch (err) {
    mapPrismaError(err);
  }
  if (store === null) throw new NotFoundError('Store', input.storeId);
  return importWorkbook(commissionTariffAdapter, {
    organizationId: store.organizationId,
    storeId: store.id,
    platform: store.platform,
    file: input.file,
    filename: input.filename,
    createdBy: input.createdBy,
    name: input.name,
    config: undefined,
    now: input.now,
  });
}
