// Public API of the Trendyol order-sync integration. Exposes an async
// generator that pages through /integration/order/sellers/{supplierId}/orders
// (getShipmentPackages), maps each batch to KDV-split DTOs, and stops when
// the time window is exhausted. Has no DB or Prisma awareness — the caller
// (OrderSyncService) handles upsert + applyEstimateOnOrderCreate.
//
// Source-of-truth for endpoint shape:
//   docs/integrations/trendyol/research/2026-05-18-hakedis-bulgulari.md §7
//   docs/integrations/trendyol/7-trendyol-marketplace-entegrasyonu/
//     siparis-entegrasyonlari.md
//
// Order Sync epic design:
//   docs/plans/2026-05-19-trendyol-order-sync-design.md §2

import { Decimal } from 'decimal.js';

import type { StoreEnvironment } from '@pazarsync/db';
import { syncLog } from '@pazarsync/sync-core';
import { businessZoneEpochToInstant } from '@pazarsync/utils';

import { TRENDYOL_COMMISSION_VAT_RATE, commissionVatDivisor } from './constants';
import { fetchOnce, type FetcherDeps } from './fetch-once';
import { baseUrlFor } from './headers';
import type {
  MappedOrder,
  MappedOrderLine,
  MappedOrdersPageMeta,
  TrendyolCredentials,
  TrendyolOrderLine,
  TrendyolOrdersResponse,
  TrendyolOrdersStreamResponse,
  TrendyolShipmentPackage,
} from './types';

/**
 * Trendyol getShipmentPackages page size.
 *
 * Documented max via `size` param is 200 (research §7 + official docs).
 * Larger values cause Trendyol to silently cap or 400 (pattern observed
 * with /products/approved size=1000). 200 is the safe production value.
 */
export const ORDERS_PAGE_SIZE = 200;

// Commission VAT rate is DB-driven (denetim A) — resolved by the caller and
// passed in as `commissionVatRate`; defaults to TRENDYOL_COMMISSION_VAT_RATE
// (the estimate fallback). Divisor via `commissionVatDivisor` ('./constants').

// ─── Request URL building ───────────────────────────────────────────────

interface PageRequest {
  startDate: number;
  endDate: number;
  size: number;
  page: number;
}

function buildUrl(base: string, supplierId: string, req: PageRequest): string {
  const url = new URL(`${base}/integration/order/sellers/${supplierId}/orders`);
  url.searchParams.set('startDate', req.startDate.toString());
  url.searchParams.set('endDate', req.endDate.toString());
  url.searchParams.set('orderByField', 'PackageLastModifiedDate');
  url.searchParams.set('orderByDirection', 'DESC');
  url.searchParams.set('size', req.size.toString());
  url.searchParams.set('page', req.page.toString());
  return url.toString();
}

// ─── Mapping (Trendyol shipmentPackage → MappedOrder) ───────────────────

/**
 * Trendyol status string → DB OrderStatus enum, or null if unmapped.
 *
 * Trendyol exposes 13 status values across `getShipmentPackages` (Title-Case)
 * and webhook subscribe targets (UPPERCASE). This mapper is case-insensitive
 * so the same function serves both paths.
 *
 * Mapping reasoning (Order Sync design §2b):
 *   - Created, Awaiting                            → PENDING
 *   - Picking, Invoiced, Unpacked, Verified        → PROCESSING
 *   - Shipped, UnDelivered, AtCollectionPoint      → SHIPPED
 *     (UnDelivered teslimat denemesi başarısız ama kargoda — Returned değil)
 *   - Delivered                                    → DELIVERED
 *   - Cancelled, Unsupplied, UnPacked              → CANCELLED
 *     (Unsupplied = satıcı tedarik edemedi, cancel'a en yakın.
 *      UnPacked = paket split ile BOZULDU — içerik `createdBy="split"` çocuk
 *      paketlerde yeniden yaşar [research 2026-06-09]. Normal akışta
 *      `MappedOrder.dematerialized` bayrağı intake'te kaydı SİLDİRİR; bu
 *      enum eşlemesi defense-in-depth — bir şekilde persist edilirse ciro-dışı
 *      CANCELLED dursun, PROCESSING gibi ciroyu 2× şişirmesin.)
 *   - Returned                                     → RETURNED
 *
 * Unknown / unmapped status → null. Caller decides:
 *   - Sync handler: ?? 'PROCESSING' (defensive, sync devam etsin)
 *   - Webhook handler: Order.status DOKUNULMAZ + log warn (forward-compat)
 */
export function mapTrendyolStatusToEnum(status: string): MappedOrder['status'] | null {
  switch (status.toUpperCase()) {
    case 'CREATED':
    case 'AWAITING':
      return 'PENDING';
    case 'PICKING':
    case 'INVOICED':
    case 'VERIFIED':
      return 'PROCESSING';
    case 'SHIPPED':
    case 'UNDELIVERED':
    case 'AT_COLLECTION_POINT':
    case 'ATCOLLECTIONPOINT':
      return 'SHIPPED';
    case 'DELIVERED':
      return 'DELIVERED';
    case 'CANCELLED':
    case 'UNSUPPLIED':
    case 'UNPACKED':
      return 'CANCELLED';
    case 'RETURNED':
      return 'RETURNED';
    default:
      return null;
  }
}

function epochMsToDate(ms: number | null | undefined): Date | null {
  if (ms === null || ms === undefined || ms === 0) return null;
  return new Date(ms);
}

/** Trendyol fast değilken `fastDeliveryType=""` döner — boş/undefined → null. */
function normalizeFastDeliveryType(value: string | undefined): string | null {
  if (value === undefined || value.length === 0) return null;
  return value;
}

/**
 * Map a single Trendyol shipmentPackage to KDV-split DTO. Pure function,
 * no I/O. Per-line VAT-aware (multi-rate orders aggregate correctly).
 *
 * Decimal arithmetic uses 2-digit precision for amount fields. VAT rate
 * is preserved as-is from Trendyol (typically integer like 20, but the
 * field is declared decimal — defensive parsing).
 */
export function mapTrendyolShipmentPackage(
  pkg: TrendyolShipmentPackage,
  commissionVatRate: number = TRENDYOL_COMMISSION_VAT_RATE,
): MappedOrder {
  const deliveredEvent = (pkg.packageHistories ?? []).find((h) => h.status === 'Delivered');
  const actualDeliveryDate =
    deliveredEvent !== undefined ? epochMsToDate(deliveredEvent.createdDate) : null;
  // actualShipDate: paketin "taşıma durumuna geçiş" anı (Shipped event). createdDate
  // GMT/true-UTC → RAW (normalize edilmez). SameDayShipping PSF kriterinin (aynı-gün
  // sevk) tabanı — originShipmentDate (hazır-anı ≈ sipariş) gerçek sevk DEĞİL.
  const shippedEvent = (pkg.packageHistories ?? []).find((h) => h.status === 'Shipped');
  const actualShipDate =
    shippedEvent !== undefined ? epochMsToDate(shippedEvent.createdDate) : null;

  const commissionDivisor = commissionVatDivisor(commissionVatRate);
  const mappedLines: MappedOrderLine[] = pkg.lines.map((line) =>
    mapLine(line, { shipmentPackageId: pkg.shipmentPackageId }, commissionDivisor),
  );

  // Package aggregate, per-line VAT-aware. Multi-vatRate order'larda her
  // line kendi vatRate'iyle hesaplanır, package toplam'ı doğru çıkar.
  let saleSubtotalNet = new Decimal(0);
  let saleVatTotal = new Decimal(0);
  for (const line of mappedLines) {
    const qty = new Decimal(line.quantity);
    saleSubtotalNet = saleSubtotalNet.add(new Decimal(line.unitPriceNet).mul(qty));
    saleVatTotal = saleVatTotal.add(new Decimal(line.unitVatAmount).mul(qty));
  }

  return {
    platformOrderId: pkg.shipmentPackageId.toString(),
    platformOrderNumber: pkg.orderNumber,
    // Trendyol stamps `orderDate` as "GMT +3" (Istanbul wall-clock-as-UTC, per
    // docs/integrations/.../siparis-entegrasyonu/ozet-ve-en-iyi-pratikler.md), so
    // a raw `new Date(orderDate)` reads 3h ahead and corrupts every business-day /
    // hour calculation. Normalize to the true instant. `lastModifiedDate` is true
    // UTC ("GMT") and `actualDeliveryDate` derives from `createdDate` (also GMT) —
    // both stay raw.
    orderDate: businessZoneEpochToInstant(pkg.orderDate),
    lastModifiedDate: new Date(pkg.lastModifiedDate),
    // Sync path: bilinmeyen status'leri PROCESSING'e düşür (defensive — sync
    // devam etsin). Webhook caller (apps/api PR-C3b) farklı bir politika
    // izler: Order.status DOKUNULMAZ + log warn (forward-compat).
    status: mapTrendyolStatusToEnum(pkg.status) ?? 'PROCESSING',
    // Split artifact: UnPacked = paket bozuldu, içerik çocuk paketlerde.
    // intakeOrder bu bayrakla kaydı (orders + buffer) SİLER (research 2026-06-09).
    dematerialized: pkg.status.toUpperCase() === 'UNPACKED',
    saleSubtotalNet: saleSubtotalNet.toFixed(2),
    saleVatTotal: saleVatTotal.toFixed(2),
    agreedDeliveryDate: epochMsToDate(pkg.agreedDeliveryDate),
    estimatedDeliveryStartDate: epochMsToDate(pkg.estimatedDeliveryStartDate),
    estimatedDeliveryEndDate: epochMsToDate(pkg.estimatedDeliveryEndDate),
    actualDeliveryDate,
    actualShipDate,
    fastDelivery: pkg.fastDelivery,
    fastDeliveryType: normalizeFastDeliveryType(pkg.fastDeliveryType),
    micro: pkg.micro,
    // PR-8 kargo alanları (research 2026-06-09). cargoTrackingNumber/cargoDeci
    // raw String() — toFixed KULLANMA (tracking no bir kimliktir, desi Trendyol
    // ne verdiyse o). originShipmentDate true UTC → RAW (normalize edilmez;
    // yalnız orderDate local-as-UTC normalize edilir).
    cargoProviderName: pkg.cargoProviderName ?? null,
    cargoTrackingNumber: pkg.cargoTrackingNumber != null ? String(pkg.cargoTrackingNumber) : null,
    cargoDeci: pkg.cargoDeci != null ? String(pkg.cargoDeci) : null,
    usesSellerCargoAgreement: pkg.whoPays === 1,
    platformCreatedBy: pkg.createdBy ?? null,
    originShipmentDate: epochMsToDate(pkg.originShipmentDate),
    lines: mappedLines,
  };
}

function mapLine(
  line: TrendyolOrderLine,
  ctx: { shipmentPackageId: number },
  commissionDivisor: Decimal,
): MappedOrderLine {
  // Defensive sparse-field handling — PR-A regression hotfix.
  //
  // Webhook payload Zod schema (apps/api/src/routes/webhooks/trendyol-orders.routes.ts,
  // PR #197) rejects lines with null/undefined `quantity` / `lineUnitPrice` /
  // `lineGrossAmount` / `vatRate` at the 422 level. The sync flow's mapper did
  // NOT have parallel validation — `new Decimal(undefined)` throws
  // `[DecimalError] Invalid argument: null` and the whole sync chunk fails
  // FAILED_RETRYABLE.
  //
  // Stage Trendyol getshipmentpackages occasionally returns sparse pricing on
  // legacy/edge orders (single bad line in a 90-day window poisons the whole
  // batch). Production prod environment returns full pricing for normal orders,
  // but a defensive mapper keeps sync resilient if Trendyol ever ships a sparse
  // order in prod.
  //
  // Fallback: `?? 0` keeps the line in the batch with effective-zero values.
  // applyEstimateOnOrderCreate runs with conservative zeros; settlement
  // reconciliation (PR-7) writes the real values when they land. Sentry/log
  // signals the data gap upstream.
  const missingFields: string[] = [];
  if (line.quantity === undefined || line.quantity === null) missingFields.push('quantity');
  if (line.lineUnitPrice === undefined || line.lineUnitPrice === null) {
    missingFields.push('lineUnitPrice');
  }
  if (line.lineGrossAmount === undefined || line.lineGrossAmount === null) {
    missingFields.push('lineGrossAmount');
  }
  if (line.vatRate === undefined || line.vatRate === null) missingFields.push('vatRate');

  if (missingFields.length > 0) {
    syncLog.warn('orders.sparse-line', {
      shipmentPackageId: ctx.shipmentPackageId,
      barcode: line.barcode,
      missingFields,
    });
  }

  const safeQuantity = line.quantity ?? 0;
  const safeGrossAmount = line.lineGrossAmount ?? 0;
  const safeSellerDiscount = line.lineSellerDiscount ?? 0;
  const safeVatRate = line.vatRate ?? 0;

  const vatRate = new Decimal(safeVatRate);
  const vatMultiplier = new Decimal(1).add(vatRate.div(100));

  // Per-unit KDV split — EFFECTIVE SALE (satıcının gerçek geliri), müşterinin
  // ödediği (lineUnitPrice) DEĞİL. effectiveSale = lineGrossAmount − lineSellerDiscount
  // (research §7.3). Trendyol-finanslı indirim (lineTyDiscount) ÇIKARILMAZ — Trendyol
  // geri öder, "kâra etkisi YOK" (research satır 336). lineUnitPrice Trendyol indirimini
  // de düştüğü için satıcı geliri değildir; ondan kâr/ciro hesaplamak co-funded siparişte
  // indirimi çift düşürür (denetim #1, 2026-06-13). unitPriceNet artık satıcı-birim-geliri.
  //
  // QUANTITY: lineGrossAmount ve lineSellerDiscount Trendyol'da BİRİM başınadır
  // ("Ürünün birim brüt fiyatı" / "Birim satıcı indirimi" — getShipmentPackagesStream
  // dokümanı). Bu yüzden effectiveSaleUnitGross DOĞRUDAN birim farkıdır (÷quantity YOK);
  // line/order toplamı saleSubtotalNet = unitPriceNet × quantity'de oluşur. Önceki kod
  // bunları line-toplamı sanıp ÷quantity yapıyordu → qty>1 siparişte satış quantity katı
  // eksik çıkıyordu (canlı doğrulama #455451555, 2026-06-14: 2 adet × ₺2120, panel
  // Satış ₺4240 / Faturalanacak ₺3816; eski kod net ₺1590 = ÷2 yanlış).
  const effectiveSaleUnitGross = Decimal.max(
    new Decimal(safeGrossAmount).sub(safeSellerDiscount),
    new Decimal(0),
  );
  const unitPriceNet = effectiveSaleUnitGross.div(vatMultiplier).toDecimalPlaces(4);
  const unitVatAmount = effectiveSaleUnitGross.sub(unitPriceNet).toDecimalPlaces(4);

  // Gross commission — SALE-side, liste üzerinden: lineGrossAmount × quantity × commission
  // / 100, sonra komisyon KDV split (oran caller'dan = commissionDivisor; DB'den çözülür,
  // denetim A). Trendyol settlement'ta önce listeden keser (handleSale), bu yüzden gross
  // taban LİSTE kalır — settlement ile tutarlı. lineGrossAmount birim olduğundan komisyon
  // alanları LINE-TOPLAMIDIR (× quantity); profit-formula bunları ×qty YAPMADAN ekler.
  const commissionRate =
    line.commission !== undefined && line.commission !== null
      ? new Decimal(line.commission)
      : new Decimal(0);
  const grossCommissionGross = new Decimal(safeGrossAmount)
    .mul(safeQuantity)
    .mul(commissionRate)
    .div(100);
  const grossCommissionAmountNet = grossCommissionGross.div(commissionDivisor).toDecimalPlaces(2);
  const grossCommissionVatAmount = grossCommissionGross
    .sub(grossCommissionAmountNet)
    .toDecimalPlaces(2);

  // Refunded commission (T+0 TAHMİN) — Trendyol satıcı-indirim payının komisyonunu
  // İADE eder (research §7.3): refunded = lineSellerDiscount × commission / 100.
  // → effective komisyon = gross − refunded = (effectiveSale × oran) / 1.2, yani
  // komisyon NET SATIŞ üzerinden (satıcının talebi, 2026-06-14). Settlement'ta
  // handleDiscount gerçek Discount satırıyla bu alanların üzerine yazar (aynı değer).
  // tyDiscount'a iade YOK (zaten effectiveSale'e dahil değil). sellerDiscount 0 → refund 0.
  // lineSellerDiscount birim olduğundan × quantity ile line-toplamına çıkarılır.
  const refundedCommissionGross = new Decimal(safeSellerDiscount)
    .mul(safeQuantity)
    .mul(commissionRate)
    .div(100);
  const refundedCommissionAmountNet = refundedCommissionGross
    .div(commissionDivisor)
    .toDecimalPlaces(2);
  const refundedCommissionVatAmount = refundedCommissionGross
    .sub(refundedCommissionAmountNet)
    .toDecimalPlaces(2);

  // Seller discount KDV split (her line kendi vatRate'iyle) — yalnız breakdown
  // gösterimi için taşınır; saleSubtotalNet'e zaten effectiveSale olarak gömülü (yukarıda).
  // lineSellerDiscount birim olduğundan × quantity ile line-toplamı gösterilir.
  const sellerDiscountGross = new Decimal(safeSellerDiscount).mul(safeQuantity);
  const sellerDiscountNet = sellerDiscountGross.div(vatMultiplier).toDecimalPlaces(2);
  const sellerDiscountVatAmount = sellerDiscountGross.sub(sellerDiscountNet).toDecimalPlaces(2);

  return {
    barcode: line.barcode,
    quantity: safeQuantity,
    platformLineId: line.lineId != null ? String(line.lineId) : null,
    unitPriceNet: unitPriceNet.toString(),
    unitVatRate: vatRate.toString(),
    unitVatAmount: unitVatAmount.toString(),
    grossCommissionAmountNet: grossCommissionAmountNet.toString(),
    grossCommissionVatAmount: grossCommissionVatAmount.toString(),
    refundedCommissionAmountNet: refundedCommissionAmountNet.toString(),
    refundedCommissionVatAmount: refundedCommissionVatAmount.toString(),
    sellerDiscountNet: sellerDiscountNet.toString(),
    sellerDiscountVatAmount: sellerDiscountVatAmount.toString(),
    commissionRate: commissionRate.toString(),
  };
}

export interface MappedOrdersPage {
  pageMeta: MappedOrdersPageMeta;
  batch: MappedOrder[];
}

/**
 * Map a full /orders page response: wraps each shipmentPackage and
 * preserves page meta for cursor advancement decisions in the caller.
 */
export function mapTrendyolOrdersResponse(
  raw: TrendyolOrdersResponse,
  commissionVatRate: number = TRENDYOL_COMMISSION_VAT_RATE,
): MappedOrdersPage {
  return {
    pageMeta: {
      totalElements: raw.totalElements,
      totalPages: raw.totalPages,
      page: raw.page,
      size: raw.size,
    },
    batch: raw.content.map((pkg) => mapTrendyolShipmentPackage(pkg, commissionVatRate)),
  };
}

// ─── Public async generator ─────────────────────────────────────────────

export interface FetchShipmentPackagesOpts {
  baseUrl?: string;
  environment?: StoreEnvironment;
  credentials: TrendyolCredentials;
  signal?: AbortSignal;
  /**
   * Window start (ms epoch). Caller responsible for chunking long backfills
   * (e.g. 30-day windows) — `fetchShipmentPackages` itself only iterates
   * pages within the given window.
   */
  startDate: number;
  /** Window end (ms epoch). */
  endDate: number;
  /**
   * Resume from a previously-saved page cursor. Existing callers pass
   * `undefined` (or omit) to start from page 0. SyncLog dispatcher passes
   * the decoded cursor so each invocation processes exactly one page.
   */
  initialPage?: number;
  /**
   * Commission VAT rate (%) for the KDV split. Resolve from the
   * `COMMISSION_INVOICE`/`ALL` FeeDefinition (denetim A) and pass in. Omit to
   * fall back to TRENDYOL_COMMISSION_VAT_RATE (estimate default, reconciled by
   * settlement).
   */
  commissionVatRate?: number;
}

/**
 * Async generator over Trendyol's /orders endpoint within a time window.
 * Yields one page at a time, fully mapped. Caller decides whether to
 * upsert each batch.
 *
 * Pagination: `page=0..N` while `(page+1) × size ≤ totalElements`. Stops
 * when an empty `content[]` is returned or all `totalElements` rows have
 * been streamed.
 *
 * Either `baseUrl` or `environment` must be supplied; in app code use
 * `environment` (resolves from env vars). Tests pass `baseUrl` to point
 * at an MSW mock.
 */
export async function* fetchShipmentPackages(
  opts: FetchShipmentPackagesOpts,
): AsyncGenerator<MappedOrdersPage, void> {
  const env = opts.environment ?? 'PRODUCTION';
  const base = opts.baseUrl ?? baseUrlFor(env);
  const deps: FetcherDeps = {
    credentials: opts.credentials,
    env,
    signal: opts.signal,
  };

  let processedSoFar = 0;
  let totalElements: number | null = null;
  let page = opts.initialPage ?? 0;

  for (;;) {
    if (deps.signal?.aborted === true) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const url = buildUrl(base, opts.credentials.supplierId, {
      startDate: opts.startDate,
      endDate: opts.endDate,
      size: ORDERS_PAGE_SIZE,
      page,
    });

    const raw = await fetchOnce<TrendyolOrdersResponse>(url, deps);
    const mapped = mapTrendyolOrdersResponse(raw, opts.commissionVatRate);

    if (totalElements === null) totalElements = mapped.pageMeta.totalElements;

    if (mapped.batch.length === 0) return;

    yield mapped;
    processedSoFar += mapped.batch.length;

    if (totalElements !== null && processedSoFar >= totalElements) return;

    page += 1;
  }
}

// ─── Stream endpoint (BUG #9 migration, 2026-05-22) ─────────────────────
//
// `getShipmentPackagesStream` is Trendyol's recommended endpoint for full
// scans, periodic sync, and large-data backfills. The page-based
// `getShipmentPackages` above is being constrained to "1 month history"
// (planned vendor change per `siparis-paketlerini-cekme-getshipmentpackages.md`
// line 3-9) — the stream endpoint exposes 3 months and is rate-limit-friendly.
//
// Differences from the page-based path:
//   - Cursor-based pagination: opaque `nextCursor` token + `hasMore` flag
//   - Filter param: `lastModifiedStartDate`/`lastModifiedEndDate` (NOT orderDate)
//   - Window cap: 14 days per call (vendor enforced; caller must chunk)
//   - Cursor binding: a cursor is tied to its filter — re-sending with
//     different start/end returns 400 Bad Request (doc line 77).
//   - Rate-limit guidance: minimum 5 second interval between calls
//     (doc line 79). The retry/backoff loop in fetchOnce already enforces
//     min 1s on transient errors; aktif rate-limit aware sleep generator
//     iç loop'ta YOK — dispatcher tick aralığı (polling backoff up to 5s)
//     bu kuralı dolaylı sağlar.

/** Trendyol stream endpoint max window per call. Caller chunks longer ranges. */
export const STREAM_WINDOW_MAX_DAYS = 14;

interface StreamPageRequest {
  lastModifiedStartDate: number;
  lastModifiedEndDate: number;
  cursor?: string;
  size: number;
}

function buildStreamUrl(base: string, supplierId: string, req: StreamPageRequest): string {
  const url = new URL(`${base}/integration/order/sellers/${supplierId}/orders/stream`);
  url.searchParams.set('lastModifiedStartDate', req.lastModifiedStartDate.toString());
  url.searchParams.set('lastModifiedEndDate', req.lastModifiedEndDate.toString());
  url.searchParams.set('size', req.size.toString());
  if (req.cursor !== undefined) {
    url.searchParams.set('nextCursor', req.cursor);
  }
  return url.toString();
}

/**
 * Opts for the stream endpoint. `lastModifiedEndDate − lastModifiedStartDate`
 * must be ≤ 14 days; the generator throws RangeError otherwise so the
 * dispatcher fails fast instead of receiving 400 from Trendyol.
 */
export interface FetchShipmentPackagesStreamOpts {
  baseUrl?: string;
  environment?: StoreEnvironment;
  credentials: TrendyolCredentials;
  signal?: AbortSignal;
  /** PackageLastModifiedDate window start (epoch ms). */
  lastModifiedStartDate: number;
  /** PackageLastModifiedDate window end (epoch ms). */
  lastModifiedEndDate: number;
  /**
   * Opaque cursor from a previous stream page. Omit (or pass undefined) to
   * start a fresh stream. Never parse — the doc treats this as a black box.
   */
  cursor?: string;
  /** Page size; defaults to ORDERS_PAGE_SIZE (200). */
  size?: number;
  /**
   * Commission VAT rate (%) for the KDV split. Resolve from the
   * `COMMISSION_INVOICE`/`ALL` FeeDefinition (denetim A) and pass in. Omit to
   * fall back to TRENDYOL_COMMISSION_VAT_RATE (estimate default, reconciled by
   * settlement).
   */
  commissionVatRate?: number;
}

/** Yield shape per stream page — caller advances via the next cursor + flag. */
export interface StreamPageResult {
  /** Mapped orders from this page. */
  batch: MappedOrder[];
  /** Trendyol's opaque cursor for the next page; null on the terminal page. */
  nextCursor: string | null;
  /** True when more pages remain in the current stream/window. */
  hasMore: boolean;
}

const MS_PER_DAY_STREAM = 24 * 60 * 60 * 1000;

/**
 * Async generator over Trendyol's `getShipmentPackagesStream` within a
 * `lastModifiedStartDate`/`lastModifiedEndDate` window (≤14 days per call,
 * vendor enforced). Yields one page at a time; the caller drives cursor
 * advancement by re-invoking with the previous `nextCursor` or by closing
 * the stream when `hasMore` is false.
 *
 * Window validation: throws RangeError if the window exceeds
 * `STREAM_WINDOW_MAX_DAYS`. Caller must chunk longer ranges into ≤14d
 * sliding windows (mirrors the settlement-cron `FINANCIAL_WINDOW_MAX_DAYS`
 * caller-chunking pattern from BUG #6).
 */
export async function* fetchShipmentPackagesStream(
  opts: FetchShipmentPackagesStreamOpts,
): AsyncGenerator<StreamPageResult, void> {
  const windowMs = opts.lastModifiedEndDate - opts.lastModifiedStartDate;
  const maxMs = STREAM_WINDOW_MAX_DAYS * MS_PER_DAY_STREAM;
  if (windowMs > maxMs) {
    throw new RangeError(
      `Stream endpoint window exceeds Trendyol max ${STREAM_WINDOW_MAX_DAYS} days: ` +
        `got ${(windowMs / MS_PER_DAY_STREAM).toFixed(1)} days. ` +
        `Chunk into sliding ${STREAM_WINDOW_MAX_DAYS}-day windows at the caller.`,
    );
  }

  const env = opts.environment ?? 'PRODUCTION';
  const base = opts.baseUrl ?? baseUrlFor(env);
  const deps: FetcherDeps = {
    credentials: opts.credentials,
    env,
    signal: opts.signal,
  };

  let cursor: string | undefined = opts.cursor;

  for (;;) {
    if (deps.signal?.aborted === true) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const url = buildStreamUrl(base, opts.credentials.supplierId, {
      lastModifiedStartDate: opts.lastModifiedStartDate,
      lastModifiedEndDate: opts.lastModifiedEndDate,
      cursor,
      size: opts.size ?? ORDERS_PAGE_SIZE,
    });

    const raw = await fetchOnce<TrendyolOrdersStreamResponse>(url, deps);
    const batch = raw.content.map((pkg) => mapTrendyolShipmentPackage(pkg, opts.commissionVatRate));

    yield { batch, nextCursor: raw.nextCursor, hasMore: raw.hasMore };

    if (raw.hasMore !== true || raw.nextCursor === null) return;
    cursor = raw.nextCursor;
  }
}
