// Public API of the Trendyol settlements + otherfinancials integration.
// Exposes two async generators that page through Trendyol's `/che/sellers/
// {supplierId}/settlements` and `/otherfinancials` endpoints, type-cast
// each batch (products.ts/orders.ts convention) and yield raw transaction
// rows. Has no DB or Prisma awareness — the dispatcher (PR-7 commit 2)
// routes each row to the right handler, the handlers (PR-7 commits 3..7)
// write to the DB.
//
// Source-of-truth for endpoint shape:
//   docs/integrations/trendyol/8-trendyol-muhasebe-ve-finans-entegrasyonu/
//     cari-hesap-ekstresi-entegrasyonu.md
//   docs/integrations/trendyol/research/2026-05-21-pr7-settlement-research.md
//   docs/integrations/trendyol/research/2026-05-18-hakedis-bulgulari.md §3 + §4
//
// Field-naming rule: every field name in the schemas mirrors Trendyol's
// wire shape EXACTLY (no "prettier" renames). BUG #5 from the Order Sync
// stage validation surfaced because we renamed `createdDate` to
// `createdAt` in the mapper — that error must not repeat here. If
// Trendyol's response field is `paymentOrderId`, the schema field is
// `paymentOrderId`, not `paymentOrderID` or `payment_order_id`.

import type { StoreEnvironment } from '@pazarsync/db';

import { fetchOnce, type FetcherDeps } from './fetch-once';
import { baseUrlFor } from './headers';
import type { TrendyolCredentials } from './types';

/**
 * Trendyol `size` cap for both /settlements and /otherfinancials is 1000
 * per the official doc (`size=500 ve 1000 değerlerini alabilir`). 1000
 * minimises HTTP roundtrips for the worst-case daily volume.
 */
export const FINANCIAL_PAGE_SIZE = 1000;

/**
 * Trendyol enforces a max 15-day window on the `startDate–endDate` range.
 * The doc is explicit: "Başlangıç ve bitiş tarihi arasındaki süre 15 günden
 * uzun olamaz." Caller must chunk longer ranges into ≤15-day sliding
 * windows. We validate at the public entry to fail fast.
 */
export const FINANCIAL_WINDOW_MAX_DAYS = 15;

// ─── Request enums ──────────────────────────────────────────────────────

/**
 * All transactionType values accepted by /settlements (per doc).
 * Routine V1 happy path = Sale + Discount + Return (research §3.3 confirmed
 * that the 60-day window for a real seller contained ZERO of the remaining
 * 19 rare types). The rare types stay enumerated here so the dispatcher
 * can route them defensively (audit log) rather than crashing on unknown.
 */
export const SETTLEMENT_TRANSACTION_TYPES = [
  'Sale',
  'Return',
  'Discount',
  'DiscountCancel',
  'Coupon',
  'CouponCancel',
  'ProvisionPositive',
  'ProvisionNegative',
  'ManualRefund',
  'ManualRefundCancel',
  'TYDiscount',
  'TYDiscountCancel',
  'TYCoupon',
  'TYCouponCancel',
  'SellerRevenuePositive',
  'SellerRevenueNegative',
  'CommissionPositive',
  'CommissionNegative',
  'SellerRevenuePositiveCancel',
  'SellerRevenueNegativeCancel',
  'CommissionPositiveCancel',
  'CommissionNegativeCancel',
] as const;
export type SettlementTransactionType = (typeof SETTLEMENT_TRANSACTION_TYPES)[number];

/**
 * All transactionType values accepted by /otherfinancials.
 */
export const OTHER_FINANCIAL_TRANSACTION_TYPES = [
  'Stoppage',
  'CashAdvance',
  'WireTransfer',
  'IncomingTransfer',
  'ReturnInvoice',
  'CommissionAgreementInvoice',
  'PaymentOrder',
  'DeductionInvoices',
  'FinancialItem',
] as const;
export type OtherFinancialTransactionType = (typeof OTHER_FINANCIAL_TRANSACTION_TYPES)[number];

/**
 * DeductionInvoices subtypes — only documented value today is
 * `PlatformServiceFee`. Other deduction subtypes (Kargo Fatura, Reklam
 * Bedeli) discriminate via the response field `transactionType` value
 * (TR-localized — see TRANSACTION_TYPE_RESPONSE_VALUES below).
 */
export const DEDUCTION_INVOICE_SUBTYPES = ['PlatformServiceFee'] as const;
export type DeductionInvoiceSubType = (typeof DEDUCTION_INVOICE_SUBTYPES)[number];

// ─── Wire-shape types (Trendyol response) ───────────────────────────────

/**
 * Single transaction row — covers both /settlements and /otherfinancials
 * because Trendyol returns identical-shaped rows from both endpoints
 * (otherfinancials adds `transactionSubType` for the DeductionInvoices
 * subtype filter; everything else is the same row with most order-level
 * fields null for period-level records).
 *
 * Sparse-field tolerance (research §3.1 + §4.1 + BUG #2 lesson):
 *   - paymentOrderId / paymentDate: NULL on first Sale arrival, then
 *     stamped by Trendyol when the PaymentOrder cycle is created (T+18..30).
 *   - barcode / orderNumber / shipmentPackageId / receiptId: all NULL on
 *     period-level otherfinancials rows (PaymentOrder, Stoppage,
 *     DeductionInvoices).
 *   - commissionRate / commissionAmount / sellerRevenue: NULL on
 *     period-level rows.
 *   - storeId / storeName / storeAddress: ALWAYS NULL for marketplace
 *     sellers (Trendyol returns these only for shop sellers).
 *   - orderDate: can be null on period-level rows.
 *   - description: NULL on Sale rows but non-null on PaymentOrder
 *     and stoppage rows.
 *   - transactionSubType: present only on otherfinancials when the
 *     DeductionInvoices subtype filter was applied.
 *
 * NOTE: runtime validation here would be ideal but the existing convention
 * (products.ts, orders.ts) uses type-cast on `res.json()`. Tracked for
 * cross-cutting cleanup with the fetchOnce promote (PR-N+1).
 */
export interface TrendyolFinancialTransaction {
  id: string;
  transactionDate: number;
  barcode: string | null;
  // Response value is TR-localized ("Satış", "Ödeme", "E-ticaret Stopajı",
  // "Platform Hizmet Bedeli", "Kargo Fatura", "Reklam Bedeli", ...). The
  // dispatcher discriminates on the REQUEST type (carried into the call
  // site), not on this field — research §2.1.
  transactionType: string;
  receiptId: number | null;
  description: string | null;
  debt: number;
  credit: number;
  paymentPeriod: number | null;
  commissionRate: number | null;
  commissionAmount: number | null;
  commissionInvoiceSerialNumber: string | null;
  sellerRevenue: number | null;
  orderNumber: string | null;
  paymentOrderId: number | null;
  paymentDate: number | null;
  sellerId: number;
  storeId: number | null;
  storeName: string | null;
  storeAddress: string | null;
  country: string;
  orderDate: number | null;
  affiliate: string;
  shipmentPackageId: number | null;
  transactionSubType?: string | null;
}

export interface TrendyolFinancialResponse {
  page: number;
  size: number;
  totalPages: number;
  totalElements: number;
  content: TrendyolFinancialTransaction[];
}

// ─── URL builders ───────────────────────────────────────────────────────

interface FinancialPageRequest {
  startDate: number;
  endDate: number;
  size: number;
  page: number;
  transactionType: string;
  transactionSubType?: string;
}

function buildSettlementsUrl(base: string, supplierId: string, req: FinancialPageRequest): string {
  const url = new URL(`${base}/integration/finance/che/sellers/${supplierId}/settlements`);
  url.searchParams.set('startDate', req.startDate.toString());
  url.searchParams.set('endDate', req.endDate.toString());
  url.searchParams.set('transactionType', req.transactionType);
  url.searchParams.set('size', req.size.toString());
  url.searchParams.set('page', req.page.toString());
  return url.toString();
}

function buildOtherFinancialsUrl(
  base: string,
  supplierId: string,
  req: FinancialPageRequest,
): string {
  const url = new URL(`${base}/integration/finance/che/sellers/${supplierId}/otherfinancials`);
  url.searchParams.set('startDate', req.startDate.toString());
  url.searchParams.set('endDate', req.endDate.toString());
  url.searchParams.set('transactionType', req.transactionType);
  if (req.transactionSubType !== undefined) {
    url.searchParams.set('transactionSubType', req.transactionSubType);
  }
  url.searchParams.set('size', req.size.toString());
  url.searchParams.set('page', req.page.toString());
  return url.toString();
}

// ─── Public API ─────────────────────────────────────────────────────────

export interface FetchFinancialOpts {
  baseUrl?: string;
  environment?: StoreEnvironment;
  credentials: TrendyolCredentials;
  startDate: Date;
  endDate: Date;
  signal?: AbortSignal;
}

export interface FetchSettlementsOpts extends FetchFinancialOpts {
  transactionType: SettlementTransactionType;
}

export interface FetchOtherFinancialsOpts extends FetchFinancialOpts {
  transactionType: OtherFinancialTransactionType;
  /**
   * Only valid with transactionType=DeductionInvoices. Filters to the
   * single documented subtype (PlatformServiceFee). Other deduction
   * categories — Kargo Fatura, Reklam Bedeli — discriminate by the
   * TR-localized `transactionType` field VALUE in the response row.
   */
  transactionSubType?: DeductionInvoiceSubType;
}

/**
 * Validates that `endDate − startDate ≤ 15 days`. Trendyol returns 400
 * on wider windows; we fail fast at the call site with a clear error
 * rather than wait for the round trip.
 */
function assertWindow(startDate: Date, endDate: Date): void {
  const diffMs = endDate.getTime() - startDate.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  if (diffDays < 0) {
    throw new RangeError(
      `startDate (${startDate.toISOString()}) must be <= endDate (${endDate.toISOString()})`,
    );
  }
  if (diffDays > FINANCIAL_WINDOW_MAX_DAYS) {
    throw new RangeError(
      `Financial endpoint window exceeds Trendyol max ${FINANCIAL_WINDOW_MAX_DAYS} days: ` +
        `got ${diffDays.toFixed(1)} days. Chunk into sliding windows at the caller.`,
    );
  }
}

/**
 * Async generator over /settlements. Yields each transaction row.
 * Caller is responsible for routing by transactionType (dispatcher in
 * PR-7 commit 2). Pagination is page-based per Trendyol contract.
 */
export async function* fetchSettlements(
  opts: FetchSettlementsOpts,
): AsyncGenerator<TrendyolFinancialTransaction, void> {
  assertWindow(opts.startDate, opts.endDate);
  const env = opts.environment ?? 'PRODUCTION';
  const base = opts.baseUrl ?? baseUrlFor(env);
  const deps: FetcherDeps = { credentials: opts.credentials, env, signal: opts.signal };

  let page = 0;
  let processedSoFar = 0;
  let totalElements: number | null = null;

  for (;;) {
    if (deps.signal?.aborted === true) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const url = buildSettlementsUrl(base, opts.credentials.supplierId, {
      startDate: opts.startDate.getTime(),
      endDate: opts.endDate.getTime(),
      size: FINANCIAL_PAGE_SIZE,
      page,
      transactionType: opts.transactionType,
    });

    const res = await fetchOnce<TrendyolFinancialResponse>(url, deps);

    if (totalElements === null) totalElements = res.totalElements;

    if (res.content.length === 0) return;

    for (const tx of res.content) yield tx;
    processedSoFar += res.content.length;

    if (totalElements !== null && processedSoFar >= totalElements) return;
    page += 1;
  }
}

/**
 * Async generator over /otherfinancials. Same pagination + window
 * semantics as fetchSettlements. Supports transactionSubType for
 * DeductionInvoices/PlatformServiceFee filtering.
 */
export async function* fetchOtherFinancials(
  opts: FetchOtherFinancialsOpts,
): AsyncGenerator<TrendyolFinancialTransaction, void> {
  assertWindow(opts.startDate, opts.endDate);
  const env = opts.environment ?? 'PRODUCTION';
  const base = opts.baseUrl ?? baseUrlFor(env);
  const deps: FetcherDeps = { credentials: opts.credentials, env, signal: opts.signal };

  let page = 0;
  let processedSoFar = 0;
  let totalElements: number | null = null;

  for (;;) {
    if (deps.signal?.aborted === true) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const url = buildOtherFinancialsUrl(base, opts.credentials.supplierId, {
      startDate: opts.startDate.getTime(),
      endDate: opts.endDate.getTime(),
      size: FINANCIAL_PAGE_SIZE,
      page,
      transactionType: opts.transactionType,
      transactionSubType: opts.transactionSubType,
    });

    const res = await fetchOnce<TrendyolFinancialResponse>(url, deps);

    if (totalElements === null) totalElements = res.totalElements;

    if (res.content.length === 0) return;

    for (const tx of res.content) yield tx;
    processedSoFar += res.content.length;

    if (totalElements !== null && processedSoFar >= totalElements) return;
    page += 1;
  }
}
