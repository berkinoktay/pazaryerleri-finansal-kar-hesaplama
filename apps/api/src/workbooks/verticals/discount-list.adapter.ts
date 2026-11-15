// The discount list page on the generic workbook pipeline. The file says which
// products are in the campaign; the discount configuration (type and parameters)
// comes with the upload form and is written onto the list row.

import { XLSX_MIME } from '../../services/tariff-export-commons';
import {
  DiscountListPathSchema,
  DiscountListStorePathSchema,
  ImportDiscountListFormSchema,
  ImportDiscountListResponseSchema,
  type DiscountConfigFields,
  type ImportDiscountListResponse,
} from '../../validators/discount-list.validator';
import type { WorkbookHttpSpec, WorkbookImportAdapter } from '../adapter';
import {
  trendyolDiscountListFormat,
  type DiscountListRow,
  type DiscountListWriteKey,
} from '../formats/trendyol/discount-list.format';
import type { trendyolDiscountListLayout } from '../formats/trendyol/discount-list.layout';
import { createManyChunked } from '../import-rows';

/** A count field of the form (validated as digits) as the list's Int column; null when absent. */
function intOrNull(value: string | undefined): number | null {
  return value === undefined ? null : Number(value);
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

export const discountListImportAdapter: WorkbookImportAdapter<
  typeof trendyolDiscountListLayout,
  DiscountListRow,
  DiscountConfigFields,
  undefined,
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
  legacyCodes: {
    EMPTY_FILE: 'EMPTY_DISCOUNT_FILE',
    WRONG_FILE_FOR_PAGE: 'INVALID_DISCOUNT_FORMAT',
  },
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
  }),
};
