/**
 * In-memory shape of Trendyol API credentials. Persisted only as an
 * AES-256-GCM ciphertext (the stores.credentials JSON column holds the
 * base64 blob). Decrypt only inside an adapter, never outside the
 * request that needs it.
 */
export interface TrendyolCredentials {
  supplierId: string;
  apiKey: string;
  apiSecret: string;
}

export function isTrendyolCredentials(value: unknown): value is TrendyolCredentials {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['supplierId'] === 'string' &&
    typeof v['apiKey'] === 'string' &&
    typeof v['apiSecret'] === 'string'
  );
}

// ─── /products/approved (v2) response shapes ─────────────────────────────
// Mirrors the wire shape exactly. Source-of-truth: docs/integrations/trendyol/
// 7-trendyol-marketplace-entegrasyonu/urun-entegrasyonlari-v2.md, plus the
// staging Postman samples (April 2026). Optional fields are typed as such
// because real responses occasionally omit them (e.g. brand on legacy
// content; deliveryDuration null on some variants).

export interface TrendyolAttribute {
  attributeId: number;
  attributeName: string;
  attributeValueId?: number;
  attributeValue: string;
}

export interface TrendyolImage {
  url: string;
}

export interface TrendyolFastDeliveryOption {
  deliveryOptionType: string;
  deliveryDailyCutOffHour: string;
}

export interface TrendyolDeliveryOptions {
  deliveryDuration: number | null;
  isRushDelivery: boolean;
  fastDeliveryOptions: TrendyolFastDeliveryOption[];
}

export interface TrendyolPrice {
  salePrice: number;
  listPrice: number;
}

export interface TrendyolStock {
  quantity: number;
  lastModifiedDate: number | null;
}

export interface TrendyolVariant {
  variantId: number;
  supplierId: number;
  barcode: string;
  attributes?: TrendyolAttribute[];
  productUrl?: string;
  onSale?: boolean;
  // The "approved" endpoint sometimes returns variants where Trendyol
  // has not yet populated price / stock / deliveryOptions — typically
  // freshly-listed variants between approval and pricing-pipeline
  // completion. The mapper handles undefined defensively rather than
  // forcing the sync to crash.
  deliveryOptions?: TrendyolDeliveryOptions;
  stock?: TrendyolStock;
  price?: TrendyolPrice;
  stockCode?: string;
  vatRate?: number;
  sellerCreatedDate?: number;
  sellerModifiedDate?: number;
  locked?: boolean;
  lockReason?: string | null;
  lockDate?: number | null;
  archived?: boolean;
  archivedDate?: number | null;
  docNeeded?: boolean;
  hasViolation?: boolean;
  blacklisted?: boolean;
  locationBasedDelivery?: string;
}

export interface TrendyolBrand {
  id: number;
  name: string;
}

export interface TrendyolCategory {
  id: number;
  name: string;
}

export interface TrendyolContent {
  contentId: number;
  productMainId: string;
  brand?: TrendyolBrand;
  category?: TrendyolCategory;
  creationDate?: number;
  lastModifiedDate?: number;
  lastModifiedBy?: string;
  title: string;
  description?: string;
  images?: TrendyolImage[];
  attributes?: TrendyolAttribute[];
  variants?: TrendyolVariant[];
}

export interface TrendyolApprovedProductsResponse {
  totalElements: number;
  totalPages: number;
  page: number;
  size: number;
  nextPageToken?: string | null;
  content: TrendyolContent[];
}

// ─── Internal DTO — mapped, normalized, ready for Prisma upsert ──────────
// The mapper produces this shape; the sync service consumes it. Decimal
// fields are strings so the boundary between fetcher (pure) and DB layer
// (Decimal) stays explicit and serializable. Timestamps are JS Date.

export interface MappedProductImage {
  url: string;
  position: number;
}

export interface MappedProductFastDeliveryOption {
  deliveryOptionType: string;
  deliveryDailyCutOffHour: string;
}

export interface MappedProductVariant {
  platformVariantId: bigint;
  barcode: string;
  stockCode: string;
  salePrice: string;
  listPrice: string;
  vatRate: number | null;
  quantity: number;
  deliveryDuration: number | null;
  isRushDelivery: boolean;
  fastDeliveryOptions: MappedProductFastDeliveryOption[];
  productUrl: string | null;
  locationBasedDelivery: string | null;
  onSale: boolean;
  archived: boolean;
  blacklisted: boolean;
  locked: boolean;
  size: string | null;
  attributes: TrendyolAttribute[];
}

export interface MappedProduct {
  platformContentId: bigint;
  productMainId: string;
  title: string;
  description: string | null;
  brandId: bigint | null;
  brandName: string | null;
  categoryId: bigint | null;
  categoryName: string | null;
  color: string | null;
  attributes: TrendyolAttribute[];
  platformCreatedAt: Date | null;
  platformModifiedAt: Date | null;
  images: MappedProductImage[];
  variants: MappedProductVariant[];
}

export interface MappedProductsPageMeta {
  totalElements: number;
  totalPages: number;
  page: number;
  size: number;
  nextPageToken: string | null;
}
