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
  // Volumetric weight ("desi" in TR parcel shipping). Not present in the
  // documented `/products/approved` example response, but real payloads
  // and the `variant-bulk-update` endpoint both speak this field. Treated
  // as optional so a missing value never breaks the sync.
  dimensionalWeight?: number;
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
  // null when Trendyol omits the value. Always lands in the
  // syncedDimensionalWeight column — never in dimensionalWeight, which is
  // exclusively the user's override (see ProductVariant schema comment).
  syncedDimensionalWeight: string | null;
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

// ─── /orders (getShipmentPackages) response shapes ───────────────────────
// Source-of-truth: docs/integrations/trendyol/research/2026-05-18-hakedis-
// bulgulari.md §7 (canlı stage + prod API research), supplemented by
// docs/integrations/trendyol/7-trendyol-marketplace-entegrasyonu/
// siparis-entegrasyonlari.md (official endpoint docs).
//
// `Trendyol Order Sync` epic design doc §2.2 has the abridged contract;
// research §7.1-§7.3 has the full per-field arithmetic (esp. KDV split).

export interface TrendyolOrderLine {
  lineId: number;
  /** Line-level seller id — webhook payloads (Trendyol stage env) may omit root
   * `supplierId` but always include this per-line. Mirror of `supplierId`. */
  sellerId?: number;
  barcode: string;
  stockCode?: string;
  productName?: string;
  productSize?: string;
  productColor?: string;
  contentId?: number;
  productCategoryId?: number;
  merchantSku?: string;
  quantity: number;
  /** Effective per-unit price (KDV dahil, indirim sonrası). */
  lineUnitPrice: number;
  /** Per-line gross amount = qty × originalUnitPrice (KDV dahil, indirim öncesi). */
  lineGrossAmount: number;
  lineSellerDiscount?: number;
  lineTyDiscount?: number;
  lineTotalDiscount?: number;
  /** Per-line VAT rate %. */
  vatRate: number;
  /** Commission rate %. Direct in order response (research §7.2). */
  commission?: number;
  currencyCode?: string;
  fastDeliveryOptions?: TrendyolFastDeliveryOption[];
  orderLineItemStatusName?: string;
}

export interface TrendyolPackageHistory {
  status: string;
  /** Status transition timestamp (ms). For 'Delivered' → actualDeliveryDate.
   * Trendyol payload field is `createdDate` (per webhook-model.md and
   * getshipmentpackages docs), not `createdAt` — historical typo. */
  createdDate: number;
}

export interface TrendyolShipmentPackage {
  /** Üst sipariş numarası — commission/payment grouping. */
  orderNumber: string;
  /** Bizim Order primary external key (= platformOrderId). */
  shipmentPackageId: number;
  shipmentNumber?: number;
  supplierId?: number;
  customerId?: number;
  /** Trendyol enum: Created|Picking|Invoiced|Shipped|Delivered|UnDelivered|Returned|Cancelled. */
  status: string;
  shipmentPackageStatus?: string;
  /** All dates in ms epoch. */
  orderDate: number;
  lastModifiedDate: number;
  agreedDeliveryDate?: number;
  estimatedDeliveryStartDate?: number;
  estimatedDeliveryEndDate?: number;
  originShipmentDate?: number;
  /** Package totals (KDV DAHİL). */
  packageGrossAmount: number;
  packageSellerDiscount?: number;
  packageTyDiscount?: number;
  packageTotalDiscount?: number;
  packageTotalPrice?: number;
  cargoProviderName?: string;
  cargoTrackingNumber?: number;
  deliveryType?: string;
  isCod?: boolean;
  commercial?: boolean;
  fastDelivery: boolean;
  micro: boolean;
  containsDangerousProduct?: boolean;
  lines: TrendyolOrderLine[];
  packageHistories?: TrendyolPackageHistory[];
}

export interface TrendyolOrdersResponse {
  totalElements: number;
  totalPages: number;
  page: number;
  size: number;
  content: TrendyolShipmentPackage[];
}

// ─── Mapped Order DTO — KDV-split, ready for Order/OrderItem upsert ─────
// design §2.3 + research §7.3 — per-line KDV ayrıştırma:
//   unitPriceNet         = lineUnitPrice / (1 + vatRate/100)
//   unitVatAmount        = lineUnitPrice − unitPriceNet
//   grossCommissionGross = lineGrossAmount × commission / 100
//   grossCommissionNet   = grossCommissionGross / 1.20  (%20 sabit, design §12.2 #1)
//   sellerDiscountNet    = lineSellerDiscount / (1 + vatRate/100)
//
// Package aggregates per-line VAT-aware (multi-rate orders correct):
//   saleSubtotalNet = Σ (qty × unitPriceNet)
//   saleVatTotal    = Σ (qty × unitVatAmount)

export interface MappedOrderLine {
  barcode: string;
  quantity: number;
  /** Decimal strings (boundary kontratı — caller Prisma Decimal'a çevirir). */
  unitPriceNet: string;
  unitVatRate: string;
  unitVatAmount: string;
  grossCommissionAmountNet: string;
  grossCommissionVatAmount: string;
  sellerDiscountNet: string;
  sellerDiscountVatAmount: string;
  /** Trendyol commission rate %, set even if commission gross 0. */
  commissionRate: string;
}

export interface MappedOrder {
  /** = shipmentPackageId.toString() — Order.platformOrderId. */
  platformOrderId: string;
  /** Üst sipariş orderNumber — Order.platformOrderNumber. */
  platformOrderNumber: string;
  orderDate: Date;
  lastModifiedDate: Date;
  /** Mapped to DB OrderStatus enum (Created → PENDING, vs.). */
  status: 'PENDING' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | 'RETURNED';
  /** Sipariş paket-toplamı agregat'ı (per-line VAT-aware). */
  saleSubtotalNet: string;
  saleVatTotal: string;
  agreedDeliveryDate: Date | null;
  /** packageHistories[status='Delivered'].createdAt'tan türetilir; teslim olmadıysa null. */
  actualDeliveryDate: Date | null;
  fastDelivery: boolean;
  micro: boolean;
  lines: MappedOrderLine[];
}

export interface MappedOrdersPageMeta {
  totalElements: number;
  totalPages: number;
  page: number;
  size: number;
}
