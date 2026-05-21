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
import { MarketplaceUnreachable, RateLimitedError } from '@pazarsync/sync-core';

import { mapTrendyolResponseToDomainError } from './errors';
import { baseUrlFor, buildAuthHeader, buildUserAgent } from './headers';
import type {
  MappedOrder,
  MappedOrderLine,
  MappedOrdersPageMeta,
  TrendyolCredentials,
  TrendyolOrderLine,
  TrendyolOrdersResponse,
  TrendyolShipmentPackage,
} from './types';

const PLATFORM = 'TRENDYOL';
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Trendyol getShipmentPackages page size.
 *
 * Documented max via `size` param is 200 (research §7 + official docs).
 * Larger values cause Trendyol to silently cap or 400 (pattern observed
 * with /products/approved size=1000). 200 is the safe production value.
 */
export const ORDERS_PAGE_SIZE = 200;

const MAX_BACKOFF_RETRIES = 4;
const INITIAL_BACKOFF_MS = 1_000;

/**
 * Commission VAT rate is 20% per Trendyol convention. design §12.2 #1
 * notes the V1 assumption — once `fatura-entegrasyonu/` docs are read
 * this becomes empirically verifiable. Until then, sabit %20 yeterli
 * (Trendyol invoice surface tutarlı çıktı veriyor — research §3.1).
 */
const COMMISSION_VAT_RATE = 20;

// ─── HTTP fetch (products.ts pattern, retry-aware) ──────────────────────

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

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal !== undefined) {
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

interface FetcherDeps {
  credentials: TrendyolCredentials;
  env: StoreEnvironment;
  signal?: AbortSignal;
}

async function fetchOnce(url: string, deps: FetcherDeps): Promise<TrendyolOrdersResponse> {
  let attempt = 0;
  for (;;) {
    let res: Response | undefined;
    let networkError = false;
    try {
      res = await fetch(url, {
        headers: {
          Authorization: buildAuthHeader(deps.credentials),
          'User-Agent': buildUserAgent(deps.credentials),
          Accept: 'application/json',
        },
        signal: deps.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      networkError = true;
    }

    if (res !== undefined && res.ok) {
      return (await res.json()) as TrendyolOrdersResponse;
    }

    const sandbox503 = res !== undefined && res.status === 503 && deps.env === 'SANDBOX';
    const isTransient =
      networkError ||
      (res !== undefined && (res.status === 429 || (res.status >= 500 && !sandbox503)));

    if (isTransient && attempt < MAX_BACKOFF_RETRIES) {
      const headerSeconds =
        res !== undefined ? parseRetryAfterSeconds(res.headers.get('Retry-After')) : null;
      const waitMs =
        headerSeconds !== null ? headerSeconds * 1000 : INITIAL_BACKOFF_MS * Math.pow(2, attempt);
      attempt += 1;
      await sleep(waitMs, deps.signal);
      continue;
    }

    if (networkError || res === undefined) {
      throw new MarketplaceUnreachable(PLATFORM, { httpStatus: 0, url });
    }
    if (res.status === 429) {
      const seconds = parseRetryAfterSeconds(res.headers.get('Retry-After')) ?? 30;
      throw new RateLimitedError(seconds, 'Trendyol rate limit hit (retries exhausted)');
    }
    const snippet = await safeReadBody(res);
    const xRequestId = res.headers.get('X-Request-ID') ?? undefined;
    mapTrendyolResponseToDomainError(res, deps.env, {
      url,
      xRequestId,
      responseBodySnippet: snippet,
    });
  }
}

async function safeReadBody(res: Response): Promise<string | undefined> {
  try {
    const text = await res.text();
    return text.slice(0, 1024);
  } catch {
    return undefined;
  }
}

function parseRetryAfterSeconds(header: string | null): number | null {
  if (header === null) return null;
  const parsed = Number.parseInt(header, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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
 *   - Cancelled, Unsupplied                        → CANCELLED
 *     (Unsupplied = satıcı tedarik edemedi, cancel'a en yakın)
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
    case 'UNPACKED':
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

/**
 * Map a single Trendyol shipmentPackage to KDV-split DTO. Pure function,
 * no I/O. Per-line VAT-aware (multi-rate orders aggregate correctly).
 *
 * Decimal arithmetic uses 2-digit precision for amount fields. VAT rate
 * is preserved as-is from Trendyol (typically integer like 20, but the
 * field is declared decimal — defensive parsing).
 */
export function mapTrendyolShipmentPackage(pkg: TrendyolShipmentPackage): MappedOrder {
  const deliveredEvent = (pkg.packageHistories ?? []).find((h) => h.status === 'Delivered');
  const actualDeliveryDate =
    deliveredEvent !== undefined ? epochMsToDate(deliveredEvent.createdDate) : null;

  const mappedLines: MappedOrderLine[] = pkg.lines.map(mapLine);

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
    orderDate: new Date(pkg.orderDate),
    lastModifiedDate: new Date(pkg.lastModifiedDate),
    // Sync path: bilinmeyen status'leri PROCESSING'e düşür (defensive — sync
    // devam etsin). Webhook caller (apps/api PR-C3b) farklı bir politika
    // izler: Order.status DOKUNULMAZ + log warn (forward-compat).
    status: mapTrendyolStatusToEnum(pkg.status) ?? 'PROCESSING',
    saleSubtotalNet: saleSubtotalNet.toFixed(2),
    saleVatTotal: saleVatTotal.toFixed(2),
    agreedDeliveryDate: epochMsToDate(pkg.agreedDeliveryDate),
    actualDeliveryDate,
    fastDelivery: pkg.fastDelivery,
    micro: pkg.micro,
    lines: mappedLines,
  };
}

function mapLine(line: TrendyolOrderLine): MappedOrderLine {
  const vatRate = new Decimal(line.vatRate);
  const vatMultiplier = new Decimal(1).add(vatRate.div(100));

  // Per-unit KDV split. Trendyol lineUnitPrice'ı KDV dahil (research §7).
  const unitPriceGross = new Decimal(line.lineUnitPrice);
  const unitPriceNet = unitPriceGross.div(vatMultiplier).toDecimalPlaces(4);
  const unitVatAmount = unitPriceGross.sub(unitPriceNet).toDecimalPlaces(4);

  // Gross commission — Trendyol formülü: lineGrossAmount × commission / 100,
  // sonra %20 KDV split. (Discount commission iadesi T+0'da YOK — Settlement
  // worker PR-7 doldurur; bu mapper sadece T+0 estimate input'u verir.)
  const commissionRate =
    line.commission !== undefined ? new Decimal(line.commission) : new Decimal(0);
  const grossCommissionGross = new Decimal(line.lineGrossAmount).mul(commissionRate).div(100);
  const commissionVatMultiplier = new Decimal(1).add(new Decimal(COMMISSION_VAT_RATE).div(100));
  const grossCommissionAmountNet = grossCommissionGross
    .div(commissionVatMultiplier)
    .toDecimalPlaces(2);
  const grossCommissionVatAmount = grossCommissionGross
    .sub(grossCommissionAmountNet)
    .toDecimalPlaces(2);

  // Seller discount KDV split (her line kendi vatRate'iyle).
  const sellerDiscountGross = new Decimal(line.lineSellerDiscount ?? 0);
  const sellerDiscountNet = sellerDiscountGross.div(vatMultiplier).toDecimalPlaces(2);
  const sellerDiscountVatAmount = sellerDiscountGross.sub(sellerDiscountNet).toDecimalPlaces(2);

  return {
    barcode: line.barcode,
    quantity: line.quantity,
    unitPriceNet: unitPriceNet.toString(),
    unitVatRate: vatRate.toString(),
    unitVatAmount: unitVatAmount.toString(),
    grossCommissionAmountNet: grossCommissionAmountNet.toString(),
    grossCommissionVatAmount: grossCommissionVatAmount.toString(),
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
export function mapTrendyolOrdersResponse(raw: TrendyolOrdersResponse): MappedOrdersPage {
  return {
    pageMeta: {
      totalElements: raw.totalElements,
      totalPages: raw.totalPages,
      page: raw.page,
      size: raw.size,
    },
    batch: raw.content.map(mapTrendyolShipmentPackage),
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

    const raw = await fetchOnce(url, deps);
    const mapped = mapTrendyolOrdersResponse(raw);

    if (totalElements === null) totalElements = mapped.pageMeta.totalElements;

    if (mapped.batch.length === 0) return;

    yield mapped;
    processedSoFar += mapped.batch.length;

    if (totalElements !== null && processedSoFar >= totalElements) return;

    page += 1;
  }
}
