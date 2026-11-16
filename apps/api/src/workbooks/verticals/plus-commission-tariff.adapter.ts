// The Plus commission tariff page on the generic workbook pipeline. The file is one
// week of Trendyol's Plus offers: one row per product, one block per period of the week.
// The periods whose label is filled on the first row are stored, each with one item per
// product row in sheet order, starting without a choice; one Plus tariff per week and
// store (an upload whose week overlaps a stored one is refused, before the import
// transaction and again inside it). The export writes each opted-in product's Plus price,
// the window's tariff selection, the reduced commission of every period the file covers
// and the no-cancel label into every row that carries its barcode, one file per window.

import { prisma, type Prisma } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';

import { isUniqueViolationOn } from '../../lib/map-transaction-error';
import {
  ImportPlusTariffFormSchema,
  ImportPlusTariffResponseSchema,
  PlusTariffIdPathSchema,
  PlusTariffStorePathSchema,
  type ImportPlusTariffResponse,
} from '../../validators/plus-commission-tariff.validator';
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
import { NO_LABEL, tariffSelectionLabel } from '../formats/trendyol/labels';
import {
  PLUS_PRICE_SCALE,
  trendyolPlusCommissionTariffFormat,
  type PlusCommissionTariffRow,
  type PlusCommissionTariffWriteKey,
} from '../formats/trendyol/plus-commission-tariff.format';
import type { trendyolPlusCommissionTariffLayout } from '../formats/trendyol/plus-commission-tariff.layout';
import { TARIFF_SELECTION_WRITE } from '../formats/trendyol/tariff-window';
import { createManyChunked } from '../import-rows';
import {
  assertNoOverlappingWeek,
  inspectUploadWeek,
  WEEK_UNIQUE_COLUMN,
  type TariffWeek,
} from '../tariff-week';
import { WorkbookInvariantError } from '../workbook-errors';

/** What the export reads of one Plus item. */
export interface PlusCommissionTariffExportItem {
  readonly barcode: string;
  readonly plusSelected: boolean;
  readonly customPrice: Prisma.Decimal | null;
  readonly plusPriceUpperLimit: Prisma.Decimal;
  readonly plusCommissionPct: Prisma.Decimal;
}

/** What a blank period offer is stored as, as the import always stored it. */
const BLANK_OFFER = '0';

const PLUS_COMMISSION_TARIFF_HTTP: WorkbookHttpSpec = {
  segment: 'plus-commission-tariffs',
  idParam: 'tariffId',
  tag: 'PlusCommissionTariffs',
  storePathSchema: PlusTariffStorePathSchema,
  itemPathSchema: PlusTariffIdPathSchema,
  importSummary: 'Import a Trendyol Plus commission-tariff Excel',
  importDescription:
    "Uploads Trendyol's Plus commission .xlsx (multipart `file`). Every column is resolved by " +
    'header name; the single 7-day period is folded onto the tariff, and each product row (one Plus ' +
    'offer: price ceiling + reduced commission) is joined to a ProductVariant by barcode. Stores one ' +
    'tariff with its product rows; profit is computed later on read. Returns counts: products, ' +
    'items, matched/unmatched products, skipped rows. Rejects a file whose header layout does not ' +
    'match the expected Plus export (422 VALIDATION_ERROR).',
  importCreated: 'Tariff imported',
  import422: 'File missing, unreadable, or not the expected tariff format',
  exportSummary: 'Export the Plus tariff as a re-uploadable Trendyol Excel',
  exportDescription:
    "Returns Trendyol's ORIGINAL uploaded file with the seller's Plus choices patched in for every " +
    'product that opted in to Plus: the chosen Plus price into "Plus Fiyat Seçimi", "{N} Günlük ' +
    'Fiyat" into "Tarife Seçimi", the reduced Plus commission into "Hesaplanan Komisyon (N Gün)", ' +
    'and "Hayır" into "İptal". Every other cell is byte-for-byte unchanged, so the file can be ' +
    're-uploaded to Trendyol verbatim. A split week yields up to three window files (a whole-week ' +
    '"7 Günlük Fiyat" file for products priced the same in both sub-periods — carrying one price but ' +
    'a commission cell per sub-period — plus "3 Günlük Fiyat" / "4 Günlük Fiyat" files for ' +
    'period-specific prices), only the non-empty ones, bundled into a single .zip. Marks the tariff ' +
    'exported. Returns 409 if the tariff has no stored source file.',
  exportOk:
    'The patched .xlsx (single file), or a .zip of the window files when a product is priced ' +
    'differently across sub-periods, ready to re-upload to Trendyol',
  export404: 'Tariff or store not found in this organization',
  export409: 'Tariff has no stored source file to export',
  exportMimes: [XLSX_MIME, ZIP_MIME],
};

/**
 * The Plus price of one item, or null when it carries none: an item the seller opted
 * into Plus writes its custom price, else the Plus price ceiling, with two decimal
 * places. An item that is not opted in carries no price, whatever its custom price.
 */
export function resolvePlusExportPrice(
  item: Pick<
    PlusCommissionTariffExportItem,
    'plusSelected' | 'customPrice' | 'plusPriceUpperLimit'
  >,
): string | null {
  if (!item.plusSelected) return null;
  return (item.customPrice ?? item.plusPriceUpperLimit).toFixed(PLUS_PRICE_SCALE);
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
  typeof trendyolPlusCommissionTariffLayout,
  PlusCommissionTariffRow,
  undefined
>): Promise<TariffWeek> {
  return inspectUploadWeek({
    table: prisma.plusCommissionTariff,
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
async function loadPlusCommissionTariff(
  { organizationId, storeId }: StoreScope,
  id: string,
): Promise<ExportSource<PlusCommissionTariffExportItem> | null> {
  let tariff;
  try {
    tariff = await prisma.plusCommissionTariff.findFirst({
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
                plusSelected: true,
                customPrice: true,
                plusPriceUpperLimit: true,
                plusCommissionPct: true,
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
 * The cells of a row whose barcode is opted in (it carries a pick): the Plus price, the
 * window's tariff selection, one computed commission per covered period that has a day
 * count (its stored percent with every digit, never in exponent form), and the
 * no-cancel label. A row without a pick writes nothing.
 */
function plusWriteBack(
  ctx: WriteContext<PlusCommissionTariffExportItem, PlusCommissionTariffWriteKey>,
): readonly CellWrite<PlusCommissionTariffWriteKey>[] {
  if (ctx.pick === null) return [];
  if (ctx.window === null) {
    throw new WorkbookInvariantError('A Plus tariff row is written into a period window');
  }
  const commissions = ctx.items.flatMap(
    ({ tag, item }): CellWrite<PlusCommissionTariffWriteKey>[] =>
      tag === null
        ? []
        : [{ key: 'computedCommission', tag, value: item.plusCommissionPct.toFixed() }],
  );
  return [
    { key: 'plusPriceSelection', value: ctx.pick },
    { key: 'tariffSelection', value: ctx.window.label },
    ...commissions,
    { key: 'cancelled', value: NO_LABEL },
  ];
}

export const plusCommissionTariffAdapter: WorkbookVerticalAdapter<
  typeof trendyolPlusCommissionTariffLayout,
  PlusCommissionTariffRow,
  undefined,
  TariffWeek,
  PlusCommissionTariffExportItem,
  ImportPlusTariffResponse,
  PlusCommissionTariffWriteKey
> = {
  page: trendyolPlusCommissionTariffFormat.page,
  parentTable: 'plus_commission_tariffs',
  countLists: (tx, { organizationId, storeId }) =>
    tx.plusCommissionTariff.count({ where: { organizationId, storeId } }),
  align: 'anchor-map',
  http: PLUS_COMMISSION_TARIFF_HTTP,
  formSchema: ImportPlusTariffFormSchema,
  responseSchema: ImportPlusTariffResponseSchema,
  readForm: (form) => {
    const { file, name } = ImportPlusTariffFormSchema.parse(form);
    return { file, name, config: undefined };
  },
  formats: [trendyolPlusCommissionTariffFormat],
  legacyCodes: {
    EMPTY_FILE: 'EMPTY_TARIFF_FILE',
    WRONG_FILE_FOR_PAGE: 'INVALID_PLUS_TARIFF_FORMAT',
    NO_PERIOD: 'NO_TARIFF_PERIOD',
    DUPLICATE_WEEK: 'DUPLICATE_TARIFF_WEEK',
  },
  inspect: inspectTariffWeek,
  nameFallback: (week) => week.present[0]?.label ?? null,
  persist: async (tx, { parent, rows, variantIdByAnchor, meta: week }) => {
    const scope: StoreScope = { organizationId: parent.organizationId, storeId: parent.storeId };
    await assertNoOverlappingWeek(tx.plusCommissionTariff, scope, week);
    const tariff = await tx.plusCommissionTariff.create({
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
      const periodRow = await tx.plusCommissionTariffPeriod.create({
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
      // carries this period's own offer.
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
        size: row.data.size,
        modelCode: row.data.modelCode,
        stock: row.data.stock,
        currentPrice: row.data.currentPrice,
        commissionBasePrice: row.data.commissionBasePrice,
        currentCommissionPct: row.data.currentCommissionPct,
        plusPriceUpperLimit: row.data.plusPriceUpperLimit,
        plusCommissionPct: row.data.periodOffers[period.layoutIndex] ?? BLANK_OFFER,
        plusCommissionBasePrice: row.data.plusCommissionBasePrice,
        externalId: row.data.externalId,
        tariffGroup: row.data.tariffGroup,
        cancelled: row.data.cancelled,
        sortOrder: index,
      }));
      await createManyChunked(items, (chunk) =>
        tx.plusCommissionTariffItem.createMany({ data: chunk }),
      );
      itemCount += items.length;
    }
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
  }),
  load: loadPlusCommissionTariff,
  notFoundResource: 'PlusCommissionTariff',
  files: 'period-windows',
  anchorOf: (item) => item.barcode,
  // Only a selected item enters the anchor map, so an unselected duplicate never
  // shadows an earlier selected one; across periods the pick is the compared price.
  pick: resolvePlusExportPrice,
  resolveWriteBack: plusWriteBack,
  touchExported: ({ organizationId, storeId }, id) =>
    prisma.plusCommissionTariff.updateMany({
      where: { id, organizationId, storeId },
      data: { exportedAt: new Date() },
    }),
};
