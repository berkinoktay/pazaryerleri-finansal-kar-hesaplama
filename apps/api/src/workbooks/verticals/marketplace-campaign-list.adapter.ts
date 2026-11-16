// The marketplace campaign page on the generic workbook pipeline. The file lists the
// products the campaign accepts, each with its current price and the highest price it
// may join at; the campaign configuration (type, parameters, Trendyol's funding rate
// and the campaign window) comes with the upload form and is written onto the campaign
// row. Every item starts without a price choice. The export pairs the campaign's items
// with the file's kept rows by position and writes each chosen price into the campaign
// price column.

import { prisma, type Prisma } from '@pazarsync/db';
import { CampaignPriceSelection } from '@pazarsync/db/enums';
import { mapPrismaError } from '@pazarsync/sync-core';

import { intOrNull } from '../../lib/optional-int';
import {
  ImportMarketplaceCampaignFormSchema,
  ImportMarketplaceCampaignResponseSchema,
  MarketplaceCampaignPathSchema,
  MarketplaceCampaignStorePathSchema,
  type ImportMarketplaceCampaignResponse,
  type MarketplaceCampaignConfigFields,
} from '../../validators/marketplace-campaign.validator';
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
  CAMPAIGN_PRICE_SCALE,
  trendyolMarketplaceCampaignListFormat,
  type MarketplaceCampaignListRow,
  type MarketplaceCampaignListWriteKey,
} from '../formats/trendyol/marketplace-campaign-list.format';
import type { trendyolMarketplaceCampaignListLayout } from '../formats/trendyol/marketplace-campaign-list.layout';
import { createManyChunked } from '../import-rows';
import { WorkbookInvariantError } from '../workbook-errors';

/** What the export reads of one campaign item. */
export interface MarketplaceCampaignExportItem {
  readonly barcode: string;
  readonly selection: CampaignPriceSelection;
  readonly maxPrice: Prisma.Decimal;
  readonly customPrice: Prisma.Decimal | null;
}

const MARKETPLACE_CAMPAIGN_HTTP: WorkbookHttpSpec = {
  segment: 'marketplace-campaigns',
  idParam: 'campaignId',
  tag: 'MarketplaceCampaigns',
  storePathSchema: MarketplaceCampaignStorePathSchema,
  itemPathSchema: MarketplaceCampaignPathSchema,
  importSummary: 'Import a Trendyol Kampanyalar participation Excel',
  importDescription:
    "Uploads Trendyol's campaign product-selection .xlsx (multipart `file`) together with the " +
    'campaign configuration. Every column is resolved by header name and the FIRST sheet is read ' +
    '(its name changes per campaign). The campaign kurgu (NET / min basket / N adet / X al Y öde / ' +
    "X. ürün), its parameters, Trendyol's funding rate and the campaign window are not in the file " +
    '— they ride in on the form and are persisted onto the campaign row. Each product row is joined ' +
    'to a ProductVariant by barcode and stored as one item with its current price and the maximum ' +
    'price Trendyol allows; the seller has made no price choice yet, so every item starts at NONE. ' +
    'Rows with no barcode, no current price or no maximum price are skipped. Returns counts: items, ' +
    'matched/unmatched products, skipped rows. Rejects a file whose header layout does not match ' +
    'the expected Kampanyalar export (422 VALIDATION_ERROR).',
  importCreated: 'Campaign imported',
  import422: 'File missing/unreadable, config invalid, or not the expected campaign format',
  exportSummary: 'Export the campaign selections as a re-uploadable Trendyol Excel',
  exportDescription:
    "Returns Trendyol's ORIGINAL uploaded file with each row's chosen price written into the " +
    '"Kampanyalı Satış Fiyatı" column: MAX writes the maximum allowed price, CUSTOM writes the ' +
    "seller's own price, NONE leaves the cell untouched (it was already empty in the source). " +
    'Only cells with a resolved price are patched — every other cell is byte-for-byte unchanged, ' +
    'so the file can be re-uploaded to Trendyol verbatim. Marks the campaign exported. Returns ' +
    '409 if the campaign has no stored source file (or it is unreadable / not a recognizable ' +
    'Kampanyalar export).',
  exportOk: 'The patched .xlsx, ready to re-upload to Trendyol',
  export404: 'Campaign or store not found in this organization',
  export409: 'Campaign has no stored source file to export',
  exportMimes: [XLSX_MIME],
};

/** The campaign and its items in sortOrder, one group; null when it is not in the scope. */
async function loadMarketplaceCampaign(
  { organizationId, storeId }: StoreScope,
  id: string,
): Promise<ExportSource<MarketplaceCampaignExportItem> | null> {
  let campaign;
  try {
    campaign = await prisma.marketplaceCampaignList.findFirst({
      where: { id, organizationId, storeId },
      select: {
        name: true,
        sourceFile: true,
        sourceFilename: true,
        sourceFormatId: true,
        items: {
          orderBy: { sortOrder: 'asc' },
          select: { barcode: true, selection: true, maxPrice: true, customPrice: true },
        },
      },
    });
  } catch (err) {
    mapPrismaError(err);
  }
  if (campaign === null) return null;
  return {
    name: campaign.name,
    sourceFile: campaign.sourceFile,
    sourceFilename: campaign.sourceFilename,
    sourceFormatId: campaign.sourceFormatId,
    groups: [{ tag: null, items: campaign.items }],
  };
}

/** A price as the campaign price cell receives it: decimal.js, two decimal places. */
function writtenPrice(price: Prisma.Decimal): string {
  return price.toFixed(CAMPAIGN_PRICE_SCALE);
}

/**
 * The price an item joins the campaign at: the maximum price for MAX, the seller's own
 * price for CUSTOM; null when the item does not join. A CUSTOM choice without a price is
 * refused at the API boundary; an older row like that writes nothing.
 */
function campaignPrice(item: MarketplaceCampaignExportItem): string | null {
  switch (item.selection) {
    case CampaignPriceSelection.MAX:
      return writtenPrice(item.maxPrice);
    case CampaignPriceSelection.CUSTOM:
      return item.customPrice === null ? null : writtenPrice(item.customPrice);
    case CampaignPriceSelection.NONE:
      return null;
    default: {
      const exhaustive: never = item.selection;
      throw new WorkbookInvariantError(`Unhandled campaign price selection: ${String(exhaustive)}`);
    }
  }
}

/**
 * The campaign price cell of a row whose item joins the campaign. A row whose item does
 * not join is left as the file has it (the template leaves the cell blank).
 */
function campaignWriteBack(
  ctx: WriteContext<MarketplaceCampaignExportItem, MarketplaceCampaignListWriteKey>,
): readonly CellWrite<MarketplaceCampaignListWriteKey>[] {
  const item = ctx.items[0]?.item;
  if (item === undefined) return [];
  const price = campaignPrice(item);
  return price === null ? [] : [{ key: 'campaignPrice', value: price }];
}

export const marketplaceCampaignListAdapter: WorkbookVerticalAdapter<
  typeof trendyolMarketplaceCampaignListLayout,
  MarketplaceCampaignListRow,
  MarketplaceCampaignConfigFields,
  undefined,
  MarketplaceCampaignExportItem,
  ImportMarketplaceCampaignResponse,
  MarketplaceCampaignListWriteKey
> = {
  page: trendyolMarketplaceCampaignListFormat.page,
  parentTable: 'marketplace_campaign_lists',
  countLists: (tx, { organizationId, storeId }) =>
    tx.marketplaceCampaignList.count({ where: { organizationId, storeId } }),
  align: 'cursor-zip',
  http: MARKETPLACE_CAMPAIGN_HTTP,
  formSchema: ImportMarketplaceCampaignFormSchema,
  responseSchema: ImportMarketplaceCampaignResponseSchema,
  readForm: (form) => {
    const { file, name, ...config } = ImportMarketplaceCampaignFormSchema.parse(form);
    return { file, name, config };
  },
  formats: [trendyolMarketplaceCampaignListFormat],
  inspect: async () => undefined,
  nameFallback: () => null,
  persist: async (tx, { parent, rows, variantIdByAnchor, config }) => {
    const campaign = await tx.marketplaceCampaignList.create({
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
        trendyolFundingPct: config.trendyolFundingPct ?? '0',
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
      listId: campaign.id,
      productVariantId: variantIdByAnchor.get(row.anchor) ?? null,
      barcode: row.data.barcode,
      productTitle: row.data.productTitle,
      productCode: row.data.productCode,
      category: row.data.category,
      brand: row.data.brand,
      color: row.data.color,
      size: row.data.size,
      stockCode: row.data.stockCode,
      stock: row.data.stock,
      externalId: row.data.externalId,
      currentPrice: row.data.currentPrice,
      maxPrice: row.data.maxPrice,
      hasCommissionTariff: row.data.hasCommissionTariff,
      sortOrder: index,
    }));
    await createManyChunked(items, (chunk) =>
      tx.marketplaceCampaignItem.createMany({ data: chunk }),
    );
    return { parentId: campaign.id, itemCount: items.length };
  },
  rejectionForUniqueViolation: () => null,
  toResponse: (outcome) => ({
    campaignId: outcome.parentId,
    name: outcome.name,
    itemCount: outcome.itemCount,
    matched: outcome.matchedRows,
    unmatched: outcome.rowCount - outcome.matchedRows,
    skippedRows: outcome.skippedRows,
  }),
  load: loadMarketplaceCampaign,
  notFoundResource: 'MarketplaceCampaignList',
  files: 'single',
  anchorOf: (item) => item.barcode,
  // cursor-zip pairs by position; the pick is never read.
  pick: () => null,
  resolveWriteBack: campaignWriteBack,
  touchExported: ({ organizationId, storeId }, id) =>
    prisma.marketplaceCampaignList.updateMany({
      where: { id, organizationId, storeId },
      data: { exportedAt: new Date() },
    }),
};
