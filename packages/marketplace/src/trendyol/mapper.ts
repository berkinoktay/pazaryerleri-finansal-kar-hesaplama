// Pure mapping layer between the Trendyol /products/approved (v2) wire
// shape and our internal MappedProduct DTO. No I/O, no DB. Tested in
// isolation with the staging Postman samples.

import { ProductVariantStatus } from '@pazarsync/db/enums';

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

function epochMsToDate(ms: number | null | undefined): Date | null {
  if (ms === null || ms === undefined || ms === 0) return null;
  return new Date(ms);
}

// Trendyol returns prices as numbers (e.g. 131231). The DB column is
// Decimal(12,2) — store the wire value as a string so JSON.stringify
// round-trips losslessly and Prisma's Decimal accepts it directly.
//
// Defensive against missing values: real Trendyol responses sometimes
// omit `price.salePrice` / `price.listPrice` on freshly-listed variants
// that haven't completed the pricing pipeline yet. Default to '0.00'
// rather than crashing the whole sync — the table will show ₺0,00 for
// these rows so the seller can spot and fix them.
export function priceToDecimalString(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '0.00';
  return value.toFixed(2);
}

// Maps an optional wire decimal to a string, returning null for absent / 0 /
// non-finite values. NOTE: the desi caller intentionally floors that null to
// '0' (`?? '0'`) — desi has a zero-floor and 0 is a valid lowest tariff tier,
// so "Trendyol omitted it" and "0" collapse to a stored 0 (not null).
function nullableDecimalString(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) return null;
  return value.toFixed(2);
}

// One status per variant. Trendyol's four wire flags are independent booleans,
// so more than one can be true at once; the single precedence archived >
// blacklisted > locked > onSale keeps the derived statuses mutually exclusive,
// so per-status counts add up to the catalog. A missing flag counts as false.
export function deriveVariantStatus(flags: {
  onSale?: boolean;
  archived?: boolean;
  blacklisted?: boolean;
  locked?: boolean;
}): ProductVariantStatus {
  if (flags.archived === true) return ProductVariantStatus.ARCHIVED;
  if (flags.blacklisted === true) return ProductVariantStatus.BLACKLISTED;
  if (flags.locked === true) return ProductVariantStatus.LOCKED;
  if (flags.onSale === true) return ProductVariantStatus.ON_SALE;
  return ProductVariantStatus.NOT_ON_SALE;
}

// The raw reason Trendyol reported for the given status: lockReason belongs to
// LOCKED and blacklistReason to BLACKLISTED. No other status carries a reason;
// a leftover lockReason on an archived or on-sale variant does not describe its
// current state.
function reasonForStatus(
  status: ProductVariantStatus,
  reasons: { lockReason?: string | null; blacklistReason?: string | null },
): string | null | undefined {
  switch (status) {
    case ProductVariantStatus.LOCKED:
      return reasons.lockReason;
    case ProductVariantStatus.BLACKLISTED:
      return reasons.blacklistReason;
    case ProductVariantStatus.ON_SALE:
    case ProductVariantStatus.NOT_ON_SALE:
    case ProductVariantStatus.ARCHIVED:
      return null;
    default: {
      const _exhaustive: never = status;
      throw new Error(`Unhandled variant status: ${_exhaustive}`);
    }
  }
}

// The reason stored next to the derived status (statusReason). An empty or
// whitespace-only string collapses to null so the UI never shows a blank
// reason; a real code is returned trimmed.
export function deriveStatusReason(
  status: ProductVariantStatus,
  reasons: { lockReason?: string | null; blacklistReason?: string | null },
): string | null {
  const raw = reasonForStatus(status, reasons);
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Trendyol's panel concatenates every "Renk" attribute with a space — categories
// often emit two entries (attrId 47 + 295 for cottons, both as attributeName
// "Renk") that the seller sees as e.g. "Red Haki" or "Black Siyah". Picking just
// the first dropped the second token. endsWith catches prefixed names like
// "[A-TDG]_Renk" or "[STG] Renk" that staging or category-specific configs
// sometimes emit; the production "Renk" case is the suffix.
function extractColor(attributes: TrendyolAttribute[]): string | null {
  const matches = attributes.filter((a) => a.attributeName.endsWith(COLOR_ATTRIBUTE_NAME));
  if (matches.length === 0) return null;
  return matches.map((a) => a.attributeValue).join(' ');
}

// Variant-level attribute name varies by category — clothing uses "Beden",
// textiles "Boyut/Ebat", footwear "Kullanım Alanı", etc. Filtering by name
// silently dropped any variant using a non-Beden attribute. Take everything;
// format "{value} {name}" to mirror the panel's "XS Beden" / "20 Boyut/Ebat".
function extractVariantLabel(attributes: TrendyolAttribute[]): string | null {
  if (attributes.length === 0) return null;
  return attributes.map((a) => `${a.attributeValue} ${a.attributeName}`).join(' ');
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
  // Trendyol's `approved` endpoint sometimes returns variants where
  // `price`, `stock`, or `deliveryOptions` are absent — typically
  // freshly-listed variants between approval and the pricing-pipeline
  // completion. Treat each section as optional with sane defaults so
  // a single bad variant doesn't kill the whole sync.
  const variantAttrs = variant.attributes ?? [];
  const status = deriveVariantStatus(variant);
  return {
    platformVariantId: BigInt(variant.variantId),
    barcode: variant.barcode,
    stockCode: variant.stockCode ?? '',
    salePrice: priceToDecimalString(variant.price?.salePrice),
    listPrice: priceToDecimalString(variant.price?.listPrice),
    vatRate: typeof variant.vatRate === 'number' ? variant.vatRate : null,
    quantity: variant.stock?.quantity ?? 0,
    deliveryDuration: variant.deliveryOptions?.deliveryDuration ?? null,
    isRushDelivery: variant.deliveryOptions?.isRushDelivery ?? false,
    fastDeliveryOptions: mapFastDeliveryOptions(variant.deliveryOptions?.fastDeliveryOptions ?? []),
    productUrl: variant.productUrl ?? null,
    locationBasedDelivery: variant.locationBasedDelivery ?? null,
    onSale: variant.onSale ?? false,
    archived: variant.archived ?? false,
    blacklisted: variant.blacklisted ?? false,
    locked: variant.locked ?? false,
    size: extractVariantLabel(variantAttrs),
    attributes: variantAttrs,
    // Desi: Trendyol bu alanı çoğu üründe hiç göndermez (ya da hesaplamadan
    // 0 yollar). İkisi de "bilinmiyor" demek — ama veride null DEĞİL, 0 olarak
    // saklarız: ürünler sayfası null yerine 0 gösterir. Desi 0 GEÇERLİ bir
    // tarife kademesidir: kargo ücreti DB tarife tablosundan (kargo firması +
    // ceil(desi)) eşleştirilir ve tablo desi 0'dan itibaren kapsar — yani
    // desi-0 ürün de gerçek (en alt kademe) kargo ücretini alır. Negatif zaten
    // imkânsız. `nullableDecimalString` 0/absent → null, `?? '0'` tabana indirir.
    syncedDimensionalWeight: nullableDecimalString(variant.dimensionalWeight) ?? '0',
    syncedCommissionRate: nullableDecimalString(variant.commission),
    status,
    statusReason: deriveStatusReason(status, variant),
  };
}

export function mapTrendyolContent(content: TrendyolContent): MappedProduct {
  const contentAttrs = content.attributes ?? [];
  return {
    platformContentId: BigInt(content.contentId),
    productMainId: content.productMainId,
    title: content.title,
    description: content.description ?? null,
    brandId: content.brand !== undefined ? BigInt(content.brand.id) : null,
    brandName: content.brand?.name ?? null,
    categoryId: content.category !== undefined ? BigInt(content.category.id) : null,
    categoryName: content.category?.name ?? null,
    color: extractColor(contentAttrs),
    attributes: contentAttrs,
    platformCreatedAt: epochMsToDate(content.creationDate),
    platformModifiedAt: epochMsToDate(content.lastModifiedDate),
    images: mapImages(content.images ?? []),
    variants: (content.variants ?? []).map(mapVariant),
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
