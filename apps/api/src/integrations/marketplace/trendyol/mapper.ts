// Pure mapping layer between the Trendyol /products/approved (v2) wire
// shape and our internal MappedProduct DTO. No I/O, no DB. Tested in
// isolation with the staging Postman samples.

import type {
  MappedProduct,
  MappedProductFastDeliveryOption,
  MappedProductImage,
  MappedProductsPageMeta,
  MappedProductVariant,
  TrendyolApprovedProductsResponse,
  TrendyolAttribute,
  TrendyolContent,
  TrendyolVariant,
} from './types';

const COLOR_ATTRIBUTE_NAME = 'Renk';
const SIZE_ATTRIBUTE_NAME = 'Beden';

function epochMsToDate(ms: number | null | undefined): Date | null {
  if (ms === null || ms === undefined || ms === 0) return null;
  return new Date(ms);
}

// Trendyol returns prices as numbers (e.g. 131231). The DB column is
// Decimal(12,2) — store the wire value as a string so JSON.stringify
// round-trips losslessly and Prisma's Decimal accepts it directly.
function priceToDecimalString(value: number): string {
  return value.toFixed(2);
}

// Trendyol's content-level attributes[] frequently has the same color
// twice (different attributeId, same attributeValue). Pick the first
// `Renk` entry; warn if multiple disagree.
function extractColor(attributes: TrendyolAttribute[]): string | null {
  const matches = attributes.filter((a) => a.attributeName === COLOR_ATTRIBUTE_NAME);
  if (matches.length === 0) return null;
  const first = matches[0];
  if (first === undefined) return null;
  if (matches.length > 1) {
    const distinct = new Set(matches.map((a) => a.attributeValue));
    if (distinct.size > 1) {
      console.warn(
        `[trendyol-mapper] content has ${matches.length.toString()} Renk attrs that disagree: ${[...distinct].join(' | ')}`,
      );
    }
  }
  return first.attributeValue;
}

function extractSize(attributes: TrendyolAttribute[]): string | null {
  const match = attributes.find((a) => a.attributeName === SIZE_ATTRIBUTE_NAME);
  return match !== undefined ? match.attributeValue : null;
}

function mapImages(images: { url: string }[]): MappedProductImage[] {
  return images.map((img, position) => ({ url: img.url, position }));
}

function mapFastDeliveryOptions(
  opts: { deliveryOptionType: string; deliveryDailyCutOffHour: string }[],
): MappedProductFastDeliveryOption[] {
  return opts.map((o) => ({
    deliveryOptionType: o.deliveryOptionType,
    deliveryDailyCutOffHour: o.deliveryDailyCutOffHour,
  }));
}

function mapVariant(variant: TrendyolVariant): MappedProductVariant {
  return {
    platformVariantId: BigInt(variant.variantId),
    barcode: variant.barcode,
    stockCode: variant.stockCode,
    salePrice: priceToDecimalString(variant.price.salePrice),
    listPrice: priceToDecimalString(variant.price.listPrice),
    vatRate: typeof variant.vatRate === 'number' ? variant.vatRate : null,
    quantity: variant.stock.quantity,
    deliveryDuration: variant.deliveryOptions.deliveryDuration,
    isRushDelivery: variant.deliveryOptions.isRushDelivery,
    fastDeliveryOptions: mapFastDeliveryOptions(variant.deliveryOptions.fastDeliveryOptions),
    productUrl: variant.productUrl ?? null,
    locationBasedDelivery: variant.locationBasedDelivery ?? null,
    onSale: variant.onSale,
    archived: variant.archived,
    blacklisted: variant.blacklisted,
    locked: variant.locked,
    size: extractSize(variant.attributes),
    attributes: variant.attributes,
  };
}

export function mapTrendyolContent(content: TrendyolContent): MappedProduct {
  return {
    platformContentId: BigInt(content.contentId),
    productMainId: content.productMainId,
    title: content.title,
    description: content.description ?? null,
    brandId: content.brand !== undefined ? BigInt(content.brand.id) : null,
    brandName: content.brand?.name ?? null,
    categoryId: content.category !== undefined ? BigInt(content.category.id) : null,
    categoryName: content.category?.name ?? null,
    color: extractColor(content.attributes),
    attributes: content.attributes,
    platformCreatedAt: epochMsToDate(content.creationDate),
    platformModifiedAt: epochMsToDate(content.lastModifiedDate),
    images: mapImages(content.images),
    variants: content.variants.map(mapVariant),
  };
}

export interface MappedProductsPage {
  batch: MappedProduct[];
  pageMeta: MappedProductsPageMeta;
}

export function mapTrendyolApprovedResponse(
  response: TrendyolApprovedProductsResponse,
): MappedProductsPage {
  return {
    batch: response.content.map(mapTrendyolContent),
    pageMeta: {
      totalElements: response.totalElements,
      totalPages: response.totalPages,
      page: response.page,
      size: response.size,
      nextPageToken: response.nextPageToken ?? null,
    },
  };
}
