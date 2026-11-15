// The flash product page on the generic workbook pipeline. The file lists Trendyol's
// flash offers, one row per product and date, each with a 24-hour and a 3-hour offer;
// every offer row is stored as one item, in sheet order, and starts without a choice.
// The export pairs the list's items with the file's kept rows by position, so a choice
// lands on its own row even when the product repeats on other dates, and writes the
// participation label (and, for the seller's own price, that price) into the row.

import { prisma, type Prisma } from '@pazarsync/db';
import { FlashOfferType } from '@pazarsync/db/enums';
import { mapPrismaError } from '@pazarsync/sync-core';

import {
  FlashProductListPathSchema,
  FlashProductStorePathSchema,
  ImportFlashProductsFormSchema,
  ImportFlashProductsResponseSchema,
  type ImportFlashProductsResponse,
} from '../../validators/flash-product.validator';
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
  FLASH_PRICE_SCALE,
  trendyolFlashProductListFormat,
  type FlashProductListRow,
  type FlashProductListWriteKey,
} from '../formats/trendyol/flash-product-list.format';
import type { trendyolFlashProductListLayout } from '../formats/trendyol/flash-product-list.layout';
import {
  FLASH_CUSTOM_PRICE_LABEL,
  FLASH_OFFER_24H_LABEL,
  FLASH_OFFER_3H_LABEL,
} from '../formats/trendyol/labels';
import { createManyChunked } from '../import-rows';

/** What the export reads of one flash item. */
export interface FlashProductExportItem {
  readonly barcode: string;
  readonly selectedOffer: FlashOfferType | null;
  readonly customPrice: Prisma.Decimal | null;
}

/** The participation label of each offer window. */
const FLASH_OFFER_LABELS: Readonly<Record<FlashOfferType, string>> = {
  [FlashOfferType.H24]: FLASH_OFFER_24H_LABEL,
  [FlashOfferType.H3]: FLASH_OFFER_3H_LABEL,
};

const FLASH_PRODUCT_HTTP: WorkbookHttpSpec = {
  segment: 'flash-products',
  idParam: 'listId',
  tag: 'FlashProducts',
  storePathSchema: FlashProductStorePathSchema,
  itemPathSchema: FlashProductListPathSchema,
  importSummary: 'Import a Trendyol Flash Products Excel',
  importDescription:
    "Uploads Trendyol's Flaş Ürünler .xlsx (multipart `file`). Every column is resolved by header " +
    'name. A row carries up to two flash offers — a 24-hour window and a 3-hour window, each with its ' +
    'own price and start/end dates — and the same product can appear on several rows (different dates). ' +
    'Each offer row is joined to a ProductVariant by barcode and stored as one item; the reduced ' +
    "commission is READ from the store's Commission Tariff at compute time. Rows with neither offer " +
    'are skipped. Returns counts: distinct products, items, matched/unmatched products, skipped rows. ' +
    'Rejects a file whose header layout does not match the expected Flash export (422 VALIDATION_ERROR).',
  importCreated: 'Flash product list imported',
  import422: 'File missing, unreadable, or not the expected flash format',
  exportSummary: 'Export the Flash Products list as a re-uploadable Trendyol Excel',
  exportDescription:
    "Returns Trendyol's ORIGINAL uploaded file with each selected row's participation written back: " +
    'the "Güncellenecek Fiyat" column gets "24 Saat" / "3 Saat" / "Senin Belirlediğin Flaş Fiyatı", ' +
    'and a custom row additionally gets its numeric price in the "Senin Belirlediğin Flaş Fiyatı" ' +
    'column (an offer row leaves it untouched — Trendyol reads the 24 Saat / 3 Saat price). Every ' +
    'other cell is byte-for-byte unchanged, so the file can be re-uploaded to Trendyol verbatim; a ' +
    'list with no selections streams back verbatim. Single file (no periods). Marks the list ' +
    'exported. Returns 409 if the list has no stored source file (or it is unreadable / lacks the ' +
    'writable column).',
  exportOk: 'The patched .xlsx, ready to re-upload to Trendyol',
  export404: 'List or store not found in this organization',
  export409: 'List has no stored source file to export',
  exportMimes: [XLSX_MIME],
};

/** The list and its items in sortOrder, one group; null when it is not in the scope. */
async function loadFlashProductList(
  { organizationId, storeId }: StoreScope,
  id: string,
): Promise<ExportSource<FlashProductExportItem> | null> {
  let list;
  try {
    list = await prisma.flashProductList.findFirst({
      where: { id, organizationId, storeId },
      select: {
        name: true,
        sourceFile: true,
        sourceFilename: true,
        sourceFormatId: true,
        items: {
          orderBy: { sortOrder: 'asc' },
          select: { barcode: true, selectedOffer: true, customPrice: true },
        },
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
 * The cells of a row whose item carries a choice. The seller's own price is checked
 * first, so it wins over an offer chosen beside it (the API refuses the two together;
 * an older row may hold both): it writes the custom label and the price, two decimal
 * places. An offer writes its label only; Trendyol reads the offer's own price. A row
 * without a choice is left as the file has it.
 */
function flashWriteBack(
  ctx: WriteContext<FlashProductExportItem, FlashProductListWriteKey>,
): readonly CellWrite<FlashProductListWriteKey>[] {
  const item = ctx.items[0]?.item;
  if (item === undefined) return [];
  if (item.customPrice !== null) {
    return [
      { key: 'updatedPrice', value: FLASH_CUSTOM_PRICE_LABEL },
      { key: 'customFlashPrice', value: item.customPrice.toFixed(FLASH_PRICE_SCALE) },
    ];
  }
  if (item.selectedOffer !== null) {
    return [{ key: 'updatedPrice', value: FLASH_OFFER_LABELS[item.selectedOffer] }];
  }
  return [];
}

export const flashProductListAdapter: WorkbookVerticalAdapter<
  typeof trendyolFlashProductListLayout,
  FlashProductListRow,
  undefined,
  undefined,
  FlashProductExportItem,
  ImportFlashProductsResponse,
  FlashProductListWriteKey
> = {
  page: trendyolFlashProductListFormat.page,
  parentTable: 'flash_product_lists',
  countLists: (tx, { organizationId, storeId }) =>
    tx.flashProductList.count({ where: { organizationId, storeId } }),
  align: 'cursor-zip',
  http: FLASH_PRODUCT_HTTP,
  formSchema: ImportFlashProductsFormSchema,
  responseSchema: ImportFlashProductsResponseSchema,
  readForm: (form) => {
    const { file, name } = ImportFlashProductsFormSchema.parse(form);
    return { file, name, config: undefined };
  },
  formats: [trendyolFlashProductListFormat],
  legacyCodes: {
    EMPTY_FILE: 'EMPTY_FLASH_FILE',
    WRONG_FILE_FOR_PAGE: 'INVALID_FLASH_FORMAT',
  },
  inspect: async () => undefined,
  nameFallback: () => null,
  persist: async (tx, { parent, rows, variantIdByAnchor }) => {
    const list = await tx.flashProductList.create({
      data: {
        organizationId: parent.organizationId,
        storeId: parent.storeId,
        name: parent.name,
        sourceFilename: parent.sourceFilename,
        sourceFile: parent.sourceFile,
        sourceFormatId: parent.sourceFormatId,
        createdBy: parent.createdBy,
      },
      select: { id: true },
    });
    // One item per offer row, in sheet order: the export pairs items with rows by it.
    // No choice is read from the file; every item starts without one.
    const items = rows.map((row, index) => ({
      organizationId: parent.organizationId,
      storeId: parent.storeId,
      listId: list.id,
      productVariantId: variantIdByAnchor.get(row.anchor) ?? null,
      modelCode: row.data.modelCode,
      barcode: row.data.barcode,
      productTitle: row.data.productTitle,
      category: row.data.category,
      brand: row.data.brand,
      stock: row.data.stock,
      externalId: row.data.externalId,
      currentPrice: row.data.currentPrice,
      customerPrice: row.data.customerPrice,
      currentCommissionPct: row.data.currentCommissionPct,
      hasCommissionTariff: row.data.hasCommissionTariff,
      campaignedProduct: row.data.campaignedProduct,
      offer24Price: row.data.offer24?.price ?? null,
      offer24StartsAt: row.data.offer24?.startsAt ?? null,
      offer24EndsAt: row.data.offer24?.endsAt ?? null,
      offer3Price: row.data.offer3?.price ?? null,
      offer3StartsAt: row.data.offer3?.startsAt ?? null,
      offer3EndsAt: row.data.offer3?.endsAt ?? null,
      sortOrder: index,
    }));
    await createManyChunked(items, (chunk) => tx.flashProductItem.createMany({ data: chunk }));
    return { parentId: list.id, itemCount: items.length };
  },
  rejectionForUniqueViolation: () => null,
  // Counts are per product: the same product spans several offer rows.
  toResponse: (outcome) => ({
    listId: outcome.parentId,
    name: outcome.name,
    productCount: outcome.distinctCount,
    itemCount: outcome.itemCount,
    matched: outcome.matchedDistinct,
    unmatched: outcome.distinctCount - outcome.matchedDistinct,
    skippedRows: outcome.skippedRows,
  }),
  load: loadFlashProductList,
  notFoundResource: 'FlashProductList',
  files: 'single',
  anchorOf: (item) => item.barcode,
  // cursor-zip pairs by position; the pick is never read.
  pick: () => null,
  resolveWriteBack: flashWriteBack,
  touchExported: ({ organizationId, storeId }, id) =>
    prisma.flashProductList.updateMany({
      where: { id, organizationId, storeId },
      data: { exportedAt: new Date() },
    }),
};
