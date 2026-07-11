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
  // Desi. Trendyol omits it on most products (or sends an uncomputed 0); both
  // collapse to '0' (the mapper applies `?? '0'`) so the value is never null.
  // Always lands in the syncedDimensionalWeight column — never in
  // dimensionalWeight, which is exclusively the user's override (see
  // ProductVariant schema comment).
  syncedDimensionalWeight: string;
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

// ─── /products/approved/inventory-and-price (v2) response shapes ──────────
// The "stock and price only" projection of the approved-products endpoint.
// Source-of-truth: docs/integrations/trendyol/7-trendyol-marketplace-
// entegrasyonu/urun-entegrasyonu-v2/urun-filtreleme-onayli-urun-v2-stok-ve-
// fiyat.md. Same page/size/nextPageToken pagination as /products/approved
// (page x size <= 10,000, then nextPageToken). Prices/quantity are optional
// because Trendyol omits them on freshly-listed variants whose pricing
// pipeline has not completed.

export interface TrendyolInventoryVariant {
  variantId: number;
  barcode: string;
  salePrice?: number | null;
  listPrice?: number | null;
  quantity?: number | null;
  stockCode?: string;
  stockLastModifiedDate?: number | null;
}

export interface TrendyolInventoryContent {
  contentId: number;
  productMainId: string;
  variants?: TrendyolInventoryVariant[];
}

export interface TrendyolInventoryAndPriceResponse {
  totalElements: number;
  totalPages: number;
  page: number;
  size: number;
  nextPageToken?: string | null;
  content: TrendyolInventoryContent[];
}

// ─── Mapped inventory delta DTO — flat per-variant, ready for the diff ────
// The PRODUCTS_DELTA handler only cares about the variant-level stock+price
// fields, so the fetcher flattens content.variants[] into one batch. Decimal
// fields are 2-dp strings (same boundary contract as MappedProductVariant).

export interface MappedInventoryVariant {
  platformVariantId: bigint;
  barcode: string;
  quantity: number;
  salePrice: string;
  listPrice: string;
}

export interface MappedInventoryPage {
  batch: MappedInventoryVariant[];
  /** Number of content items on this page — the progress unit (matches the
   * approved endpoint's totalElements, which counts content, not variants). */
  contentCount: number;
  pageMeta: MappedProductsPageMeta;
}

// ─── /orders (getShipmentPackages) response shapes ───────────────────────
// Source-of-truth: docs/integrations/trendyol/research/2026-05-18-hakedis-
// bulgulari.md §7 (canlı stage + prod API research), supplemented by
// docs/integrations/trendyol/7-trendyol-marketplace-entegrasyonu/
// siparis-entegrasyonlari.md (official endpoint docs).
//
// `Trendyol Order Sync` epic design doc §2.2 has the abridged contract;
// research §7.1-§7.3 has the full per-field arithmetic (esp. KDV split).

/**
 * Per-UNIT discount breakdown entry inside a Trendyol order line's
 * `discountDetails[]`. Each element corresponds to one of the `quantity`
 * units of the line. Trendyol rounds units unevenly (e.g. 16,01 + 16 + 16 =
 * 48,01 ≠ 16 × 3 = 48,00), so the AUTHORITATIVE per-line totals come from
 * summing this array — never from `lineSellerDiscount × quantity` (which
 * drifts by a kuruş). `lineItemPrice` is the effective sale (indirim sonrası,
 * KDV dahil) for that single unit.
 */
export interface TrendyolDiscountDetail {
  /** Effective sale for a single unit (KDV dahil, satıcı indirimi sonrası). */
  lineItemPrice: number;
  /** Seller discount applied to a single unit (KDV dahil). */
  lineItemSellerDiscount: number;
}

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
  /** Trendyol per-UNIT gross amount (KDV dahil, indirim öncesi). Line total =
   * lineGrossAmount × quantity. UNIT-başına, satır-toplamı DEĞİL (#337). */
  lineGrossAmount: number;
  lineSellerDiscount?: number;
  lineTyDiscount?: number;
  lineTotalDiscount?: number;
  /**
   * Per-unit discount breakdown (one element per unit). AUTHORITATIVE source
   * for per-line sale/discount totals — Σ over this array captures Trendyol's
   * uneven per-unit rounding (16,01 + 16 + 16 = 48,01), which `lineSellerDiscount
   * × quantity` does not. Single-unit lines carry a 1-element array. Optional:
   * some legacy/edge payloads omit it → mapper falls back to lineGrossAmount × qty.
   */
  discountDetails?: TrendyolDiscountDetail[];
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
  /** Trendyol'un ölçtüğü desi — prod-only, kargo ölçümünden sonra dolar. */
  cargoDeci?: number;
  /** 1 = satıcının kendi kargo anlaşması (Trendyol kargo faturası kesmez);
   * alan yoksa Trendyol anlaşması (research 2026-06-09 + Berkin teyidi). */
  whoPays?: number;
  /** Paket kaynağı: "order-creation" | "split" | "transfer" | … */
  createdBy?: string;
  /** Split soy ağacı — bölünerek oluşan paketlerde kaynak paket id'leri. */
  originPackageIds?: number[] | null;
  deliveryType?: string;
  isCod?: boolean;
  commercial?: boolean;
  fastDelivery: boolean;
  /** Hızlı-teslim tipi: "TodayDelivery" | "SameDayShipping" | "FastDelivery"
   * (doc satır 50). Fast değilse "" döner. Sipariş-seviyesinde yalnız PROD'da
   * dolar (stage test siparişleri "" verir — 2026-06-14 gözlem). */
  fastDeliveryType?: string;
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

/**
 * Response shape for `getShipmentPackagesStream` — cursor-based pagination.
 *
 * Unlike `TrendyolOrdersResponse` (page-based), this endpoint omits
 * `totalElements`/`totalPages` and provides an opaque `nextCursor` token
 * plus an explicit `hasMore` flag. The cursor must be passed back verbatim
 * on subsequent calls; sending the same cursor with different
 * `lastModifiedStartDate/EndDate` filters returns 400 Bad Request.
 *
 * Source: docs/integrations/trendyol/7-trendyol-marketplace-entegrasyonu/
 * siparis-entegrasyonu/siparis-paketlerini-akis-ile-cekme-getshipmentpackagesstream.md
 */
export interface TrendyolOrdersStreamResponse {
  /** True if more pages exist; false on the terminal page of a stream. */
  hasMore: boolean;
  /** Opaque cursor for the next call; null on the terminal page. */
  nextCursor: string | null;
  /** Number of items returned in this page (≤ requested `size`). */
  size: number;
  content: TrendyolShipmentPackage[];
}

// ─── Mapped Order DTO — GROSS (KDV-dahil), ready for Order/OrderItem upsert ─
// GROSS convention refactor (spec §4, 2026-06-16). Every money term is GROSS
// (KDV dahil) + a vatRate; net/KDV are derived downstream by the profit engine,
// never re-split here. Root cause for going gross: Trendyol gives no per-LINE
// total — only a per-unit scalar (drifts: 16 × 3 = 48,00) + a per-unit
// breakdown array `discountDetails` (16,01 + 16 + 16 = 48,01) + package totals.
//
// Order header (sale/discount/list) = package totals DIRECTLY (no recompute):
//   saleGross           = packageTotalPrice
//   listGross           = packageGrossAmount
//   sellerDiscountGross = packageSellerDiscount
//   saleVat             = Σ per-line (lineSaleGross × vatRate / (100 + vatRate))
//
// Per-line split (for commission + multi-VAT/multi-product) = Σ discountDetails:
//   lineSaleGross           = Σ discountDetails.lineItemPrice
//                             (fallback: lineGrossAmount × quantity when absent)
//   lineSellerDiscountGross = Σ discountDetails.lineItemSellerDiscount
//   lineListGross           = lineGrossAmount × quantity
//   commissionGross         = commissionRate × lineSaleGross   (net-sale base #332)
//   refundedCommissionGross = commissionRate × lineSellerDiscountGross  (T+0 estimate)
//
// Invariant: Σ lineSaleGross = packageTotalPrice → syncLog.warn on mismatch
// (no silent drift). Intra-line scalar-vs-details drift is EXPECTED (no warn).
// promotionDisplays surfaces the seller-discount total for the UI (ekleme #3).

export interface PromotionDisplay {
  displayName: string;
  amountGross: string;
}

export interface MappedOrderLine {
  barcode: string;
  quantity: number;
  /** Trendyol lines[].lineId — platform satır kimliği (string'e çevrilmiş). */
  platformLineId: string | null;
  /** Decimal strings (boundary kontratı — caller Prisma Decimal'a çevirir). */
  lineListGross: string;
  lineSaleGross: string;
  lineSellerDiscountGross: string;
  saleVatRate: string;
  commissionRate: string;
  commissionGross: string;
  /**
   * T+0 estimate of the commission Trendyol refunds on the seller-discount
   * portion (research §7.3): commissionRate × lineSellerDiscountGross. Settlement
   * (handleDiscount) overwrites with the real Discount line. 0 when no discount.
   */
  refundedCommissionGross: string;
  /** Commission VAT rate %, DB-driven default (#331); net split derived downstream. */
  commissionVatRate: string;
  /**
   * Trendyol lines[].productCategoryId — stringified for boundary parity with the
   * other id/money fields (downstream converts to BigInt). null when the payload
   * omits it. Used by order-intake to fall back to a DB category commission rate
   * when the line carries no commission of its own.
   */
  categoryId: string | null;
  /**
   * True only when Trendyol actually carried a commission rate on the line.
   * When false, commissionRate/commissionGross are the defensive 0 fallback (not a
   * real zero), signalling order-intake to resolve the rate from the category.
   */
  commissionKnown: boolean;
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
  /**
   * True when Trendyol reports the package as `UnPacked` — the package was
   * dissolved by a split (research 2026-06-09: the original package stays in
   * the feed with status UnPacked while `createdBy="split"` children re-carry
   * its full content under new shipmentPackageIds). A dematerialized package
   * must be REMOVED from our books, not persisted: keeping it counts the
   * revenue twice (once on the ghost, once on the children). `intakeOrder`
   * branches on this flag before any other routing.
   */
  dematerialized: boolean;
  /** Sipariş başlığı — paket toplamlarından DOĞRUDAN (KDV dahil, spec §4). */
  saleGross: string;
  saleVat: string;
  listGross: string;
  sellerDiscountGross: string;
  /** Promosyon gösterimi (satıcı indirimi toplamı); indirim yoksa null (ekleme #3). */
  promotionDisplays: PromotionDisplay[] | null;
  agreedDeliveryDate: Date | null;
  /** packageHistories[status='Delivered'].createdAt'tan türetilir; teslim olmadıysa null. */
  actualDeliveryDate: Date | null;
  /** Türetilmiş: actualDeliveryDate ≤ agreedDeliveryDate → zamanında (true). İki
   * tarihten biri yoksa null. computeDeliveredOnTime ile mapper'da hesaplanır.
   * Opsiyonel: buffer JSONB'sinden gelen eski mappedOrder kayıtlarında yoktur
   * (undefined) — upsert `?? null` ile karşılar. */
  deliveredOnTime?: boolean | null;
  /** packageHistories[status='Shipped'].createdAt'tan türetilir ("taşıma durumuna
   * geçiş"); sevk olmadıysa null. SameDayShipping PSF kriterinin (aynı-gün sevk) tabanı. */
  actualShipDate: Date | null;
  fastDelivery: boolean;
  /** Sipariş-seviyesi hızlı-teslim tipi (PROD'da dolu: "FastDelivery" /
   * "SameDayShipping" / "TodayDelivery"; fast değil/boş → null). Kriter hangi
   * tip kuralını uygulayacağını buradan bilir (2026-06-14 hibrit tasarım). */
  fastDeliveryType: string | null;
  micro: boolean;
  /** Trendyol tahmini teslim penceresi (PROD'da dolu; stage'de 0 → null). */
  estimatedDeliveryStartDate: Date | null;
  estimatedDeliveryEndDate: Date | null;
  // ── PR-8 kargo alanları (research 2026-06-09) ──
  /** Kargo firması adı (örn. "Trendyol Express Marketplace"). */
  cargoProviderName: string | null;
  /** Kargo takip no — kargo faturası parcelUniqueId'si ile birebir aynı. */
  cargoTrackingNumber: string | null;
  /** Trendyol'un ölçtüğü desi (decimal string) — prod-only. */
  cargoDeci: string | null;
  /** whoPays==1 → satıcının kendi kargo anlaşması. */
  usesSellerCargoAgreement: boolean;
  /** Paket kaynağı ("order-creation" | "split" | …). */
  platformCreatedBy: string | null;
  /** Kargoya-hazır anı (true UTC, RAW — normalize edilmez). */
  originShipmentDate: Date | null;
  lines: MappedOrderLine[];
}

export interface MappedOrdersPageMeta {
  totalElements: number;
  totalPages: number;
  page: number;
  size: number;
}
