import type { ProductVariantStatus } from '@pazarsync/db/enums';

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

// Since Trendyol's August 2026 delivery simplification the approved v2
// response carries only the shipping duration here: 0 = ships today,
// 1 = ships by tomorrow, and an empty object when the seller set none.
// The older rush flag and fast-delivery option list are no longer sent.
export interface TrendyolDeliveryOptions {
  deliveryDuration?: number | null;
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
  // Variant-level commission PERCENT (e.g. 7.83) documented in the approved-products
  // v2 example response (docs/integrations/trendyol/7-trendyol-marketplace-entegrasyonu/
  // urun-entegrasyonu-v2/urun-filtreleme-onayli-urun-v2.md:323). Optional: treat a
  // missing value as "Trendyol didn't say", never as an error.
  commission?: number | null;
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
  // Not in the documented response; the stage probe (2026-10-27) saw it in live
  // payloads. The blacklist counterpart of lockReason.
  blacklistReason?: string | null;
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
  // as optional and nullable so a missing value never breaks the sync; the
  // mapper turns a missing value into a null synced desi.
  dimensionalWeight?: number | null;
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

/**
 * Values of the approved v2 `dateQueryType` parameter
 * (urun-entegrasyonu-v2/urun-filtreleme-onayli-urun-v2.md):
 *   - VARIANT_CREATED_DATE  -> variant `sellerCreatedDate`
 *   - VARIANT_MODIFIED_DATE -> variant `sellerModifiedDate`
 *   - CONTENT_MODIFIED_DATE -> content `lastModifiedDate`
 * Without a `dateQueryType` Trendyol silently ignores `startDate`/`endDate`
 * and returns the whole catalog (stage, 2026-10-27), so a date query must
 * always carry one.
 */
export const TRENDYOL_DATE_QUERY_TYPES = [
  'VARIANT_CREATED_DATE',
  'VARIANT_MODIFIED_DATE',
  'CONTENT_MODIFIED_DATE',
] as const;
export type TrendyolDateQueryType = (typeof TRENDYOL_DATE_QUERY_TYPES)[number];

export interface TrendyolApprovedProductsResponse {
  totalElements: number;
  totalPages: number;
  page: number;
  size: number;
  // Single-page responses leave the key out entirely (stage, 2026-10-27).
  nextPageToken?: string | null;
  // Stage answers an empty date window and a page past the last one with
  // `content: []` (2026-10-28), but the claims endpoint has sent
  // `content: null` on narrow windows, so the wire type admits a missing or
  // null list. What that means is the fetcher's call, not the mapper's: the
  // single-page date query treats it as an empty page, while the full scan
  // and the barcode lookup throw (see products.ts).
  content?: TrendyolContent[] | null;
}

/**
 * An approved-products response whose `content` list is present: the input
 * of `mapTrendyolApprovedResponse`. A fetcher must settle a null or missing
 * list before it maps, so no caller inherits another caller's choice.
 */
export type TrendyolApprovedProductsWithContent = TrendyolApprovedProductsResponse & {
  content: TrendyolContent[];
};

// ─── Internal DTO — mapped, normalized, ready for Prisma upsert ──────────
// The mapper produces this shape; the sync service consumes it. Decimal
// fields are strings so the boundary between fetcher (pure) and DB layer
// (Decimal) stays explicit and serializable. Timestamps are JS Date.

export interface MappedProductVariant {
  platformVariantId: bigint;
  barcode: string;
  stockCode: string;
  salePrice: string;
  listPrice: string;
  vatRate: number | null;
  quantity: number;
  deliveryDuration: number | null;
  productUrl: string | null;
  size: string | null;
  attributes: TrendyolAttribute[];
  // Desi as a 2-decimal string, or null when Trendyol sent no usable desi (the
  // field is absent, null, not a number, negative, or 0 once rounded to 2
  // decimals). Trendyol omits it on some products and sends 0 on others whose desi
  // was never entered, so a Trendyol 0 is stored as null, never as '0.00'; a real
  // desi of 0 only comes from the seller's override. Always written, so a null
  // clears a desi Trendyol no longer sends. Lands in the syncedDimensionalWeight
  // column only, never in dimensionalWeightOverride, which is exclusively the
  // user's override (see ProductVariant schema comment).
  syncedDimensionalWeight: string | null;
  // Commission PERCENT synced from Trendyol (7.83 = %7.83). Like desi, a 0 is
  // not a real value: 0/absent both mean "unknown" and collapse to null — a real %0
  // commission does not exist on the wire, and downstream fallback chains must be
  // able to tell "synced" from "unknown". Lands in syncedCommissionRate only; there
  // is no user-override twin column (yet).
  syncedCommissionRate: string | null;
  // One derived status per variant (deriveVariantStatus: archived > blacklisted >
  // locked > onSale > not on sale) and the Trendyol reason that belongs to it
  // (deriveStatusReason: lockReason for LOCKED, blacklistReason for BLACKLISTED,
  // null otherwise).
  status: ProductVariantStatus;
  statusReason: string | null;
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
  // Image urls in the order Trendyol sends them (array index = position);
  // imageUrls[0] is the primary image. Mirrors the Product.imageUrls column.
  imageUrls: string[];
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
//
// Commission: only the raw line rate (commissionRate) is carried; the profit engine
// derives every commission amount and its VAT itself.
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
  /**
   * The line's raw commission rate % (decimal string). It feeds only the
   * `OrderItem.orderCommissionRatePct` raw column; the profit engine computes the
   * commission itself. "0" when the payload omits it (see `commissionKnown`).
   */
  commissionRate: string;
  /**
   * True only when Trendyol actually carried a commission rate on the line.
   * When false, commissionRate is the defensive 0 fallback (not a real zero), so
   * order intake stores a null raw rate and the engine falls back to the category.
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
  /**
   * True when Trendyol has not created the shipment package yet: its
   * `shipmentPackageId` is 0 — an Awaiting order still waiting on the payment
   * check. Such a package cannot be keyed (every one would map to
   * platformOrderId '0', so distinct order numbers would collide onto a single
   * row), so `intakeOrder` skips it entirely — no order, no buffer row, no stock
   * change. Trendyol re-sends the same order under a real shipmentPackageId once
   * it creates the package (status Created), and that one is keyed normally.
   */
  packagePending: boolean;
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
  /** Marketplace-neutral export sale flag; mapped from the package's `micro` boolean. */
  isExportSale: boolean;
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
