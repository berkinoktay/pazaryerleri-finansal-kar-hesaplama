// The discount list page on the generic workbook pipeline. The file says which
// products are in the campaign; the discount configuration (type and parameters)
// comes with the upload form and is written onto the list row. The export pairs the
// list's items with the file's kept rows by position and writes each product's
// participation back where it differs from the file.

import { prisma } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';

import { intOrNull } from '../../lib/optional-int';
import {
  DiscountListPathSchema,
  DiscountListStorePathSchema,
  ImportDiscountListFormSchema,
  ImportDiscountListResponseSchema,
  type DiscountConfigFields,
  type ImportDiscountListResponse,
} from '../../validators/discount-list.validator';
import type {
  CellWrite,
  ExportSource,
  StoreScope,
  WorkbookHttpSpec,
  WorkbookVerticalAdapter,
  WriteContext,
} from '../adapter';
import { XLSX_MIME } from '../download';
import {
  trendyolDiscountListFormat,
  type DiscountListRow,
  type DiscountListWriteKey,
} from '../formats/trendyol/discount-list.format';
import type { trendyolDiscountListLayout } from '../formats/trendyol/discount-list.layout';
import { NO_LABEL, YES_LABEL } from '../formats/trendyol/labels';
import { createManyChunked } from '../import-rows';

/** What the export reads of one list item. */
export interface DiscountListExportItem {
  readonly barcode: string;
  readonly included: boolean;
}

const DISCOUNT_LIST_HTTP: WorkbookHttpSpec = {
  segment: 'discount-lists',
  idParam: 'listId',
  tag: 'DiscountLists',
  storePathSchema: DiscountListStorePathSchema,
  itemPathSchema: DiscountListPathSchema,
  importSummary: 'Import a Trendyol İndirimler Excel',
  importDescription:
    "Uploads Trendyol's İndirimler product-selection .xlsx (multipart `file`) together with the " +
    'discount configuration fields. Every column is resolved by header name. Trendyol uses the SAME ' +
    'selection sheet for every discount type, so the discount kurgu (NET / min basket / N adet / ' +
    'X al Y öde / X. ürün / indirim kodu) and its parameters ride in on the form and are persisted ' +
    'onto the list row. Each product row is joined to a ProductVariant by barcode and stored as one ' +
    'item; a row already marked "Evet" starts as included. Rows with no barcode or no current price ' +
    'are skipped. Returns counts: items, matched/unmatched products, skipped rows. Rejects a file ' +
    'whose header layout does not match the expected İndirimler export (422 VALIDATION_ERROR).',
  importCreated: 'Discount list imported',
  import422: 'File missing/unreadable, config invalid, or not the expected discount format',
  exportSummary: 'Export the discount list as a re-uploadable Trendyol Excel',
  exportDescription:
    "Returns Trendyol's ORIGINAL uploaded file with each row's participation written back into the " +
    '"Kampayaya Dahil Edilsin Mi?" column: an included row gets "Evet", an excluded row gets "Hayır". ' +
    'Only cells that DEVIATE from the source are patched — every other cell is byte-for-byte unchanged, ' +
    'so the file can be re-uploaded to Trendyol verbatim, and a list with no changes vs. the original ' +
    'streams back byte-for-byte identical. Marks the list exported. Returns 409 if the list has no ' +
    'stored source file (or it is unreadable / not a recognizable İndirimler export).',
  exportOk: 'The patched .xlsx, ready to re-upload to Trendyol',
  export404: 'List or store not found in this organization',
  export409: 'List has no stored source file to export',
  exportMimes: [XLSX_MIME],
};

/** The list and its items in sortOrder, one group; null when the list is not in the scope. */
async function loadDiscountList(
  { organizationId, storeId }: StoreScope,
  id: string,
): Promise<ExportSource<DiscountListExportItem> | null> {
  let list;
  try {
    list = await prisma.discountList.findFirst({
      where: { id, organizationId, storeId },
      select: {
        name: true,
        sourceFile: true,
        sourceFilename: true,
        sourceFormatId: true,
        items: { orderBy: { sortOrder: 'asc' }, select: { barcode: true, included: true } },
      },
    });
  } catch (err) {
    mapPrismaError(err);
  }
  if (list === null) return null;
  return {
    name: list.name,
    sourceFile: list.sourceFile,
    sourceFilename: list.sourceFilename,
    sourceFormatId: list.sourceFormatId,
    groups: [{ tag: null, items: list.items }],
  };
}

/**
 * The participation cell, written only where the item's choice differs from the file:
 * an included item whose row does not read the yes label gets it; an excluded item
 * whose row reads it gets the no label.
 */
function discountWriteBack(
  ctx: WriteContext<DiscountListExportItem, DiscountListWriteKey>,
): readonly CellWrite<DiscountListWriteKey>[] {
  const item = ctx.items[0]?.item;
  if (item === undefined) return [];
  const sourceIncluded = ctx.source.text('included') === YES_LABEL;
  if (item.included && !sourceIncluded) return [{ key: 'included', value: YES_LABEL }];
  if (!item.included && sourceIncluded) return [{ key: 'included', value: NO_LABEL }];
  return [];
}

export const discountListAdapter: WorkbookVerticalAdapter<
  typeof trendyolDiscountListLayout,
  DiscountListRow,
  DiscountConfigFields,
  undefined,
  DiscountListExportItem,
  ImportDiscountListResponse,
  DiscountListWriteKey
> = {
  page: trendyolDiscountListFormat.page,
  parentTable: 'discount_lists',
  countLists: (tx, { organizationId, storeId }) =>
    tx.discountList.count({ where: { organizationId, storeId } }),
  align: 'cursor-zip',
  http: DISCOUNT_LIST_HTTP,
  formSchema: ImportDiscountListFormSchema,
  responseSchema: ImportDiscountListResponseSchema,
  readForm: (form) => {
    const { file, name, ...config } = ImportDiscountListFormSchema.parse(form);
    return { file, name, config };
  },
  formats: [trendyolDiscountListFormat],
  inspect: async () => undefined,
  nameFallback: () => null,
  persist: async (tx, { parent, rows, variantIdByAnchor, config }) => {
    const list = await tx.discountList.create({
      data: {
        organizationId: parent.organizationId,
        storeId: parent.storeId,
        name: parent.name,
        discountType: config.discountType,
        valueKind: config.valueKind ?? null,
        value: config.value ?? null,
        minBasketAmount: config.minBasketAmount ?? null,
        minQuantity: intOrNull(config.minQuantity),
        buyQuantity: intOrNull(config.buyQuantity),
        payQuantity: intOrNull(config.payQuantity),
        nthIndex: intOrNull(config.nthIndex),
        startsAt: config.startsAt ?? null,
        endsAt: config.endsAt ?? null,
        sourceFilename: parent.sourceFilename,
        sourceFile: parent.sourceFile,
        sourceFormatId: parent.sourceFormatId,
        createdBy: parent.createdBy,
      },
      select: { id: true },
    });
    // One item per product row, in sheet order: the export pairs items with rows by it.
    const items = rows.map((row, index) => ({
      organizationId: parent.organizationId,
      storeId: parent.storeId,
      listId: list.id,
      productVariantId: variantIdByAnchor.get(row.anchor) ?? null,
      externalId: row.data.externalId,
      productTitle: row.data.productTitle,
      brand: row.data.brand,
      color: row.data.color,
      barcode: row.data.barcode,
      modelCode: row.data.modelCode,
      currentPrice: row.data.currentPrice,
      included: row.data.included,
      sortOrder: index,
    }));
    await createManyChunked(items, (chunk) => tx.discountListItem.createMany({ data: chunk }));
    return { parentId: list.id, itemCount: items.length };
  },
  rejectionForUniqueViolation: () => null,
  toResponse: (outcome) => ({
    listId: outcome.parentId,
    name: outcome.name,
    itemCount: outcome.itemCount,
    matched: outcome.matchedRows,
    unmatched: outcome.rowCount - outcome.matchedRows,
    skippedRows: outcome.skippedRows,
    prefilledRows: outcome.prefilledRows,
  }),
  load: loadDiscountList,
  notFoundResource: 'DiscountList',
  files: 'single',
  anchorOf: (item) => item.barcode,
  // cursor-zip pairs by position; the pick is never read.
  pick: () => null,
  resolveWriteBack: discountWriteBack,
  touchExported: ({ organizationId, storeId }, id) =>
    prisma.discountList.updateMany({
      where: { id, organizationId, storeId },
      data: { exportedAt: new Date() },
    }),
};
