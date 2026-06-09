// Pure routing/classification for Trendyol settlement + otherfinancials
// transactions. Maps each REQUEST transactionType (+ DeductionInvoices
// subType discriminator) to a dispatch target — a discriminated union
// that tells the handler layer (PR-7 commits 3..7) what to do:
//
//   - order_item_update    — Sale, Discount, Coupon (item-level fields)
//   - order_fee_insert     — Return, Provision*, ManualRefund*, SellerRevenue*,
//                             Commission* (OrderFee row, source=SETTLEMENT)
//   - compensating         — DiscountCancel, CouponCancel (existing row delta)
//   - no_op                — TYDiscount/TYCoupon family (Trendyol-funded pass-through)
//   - payment_order_cycle  — PaymentOrder ("Ödeme") trigger
//   - org_period_fee_audit — Stoppage (OrgPeriodFee STOPPAGE + OrderFee STOPPAGE confirm)
//   - deduction_invoice    — DeductionInvoices (sub-class via TR-localized response value)
//   - audit_log_raw        — Rare otherfinancials types not modelled in V1
//
// Idempotency is the handler's concern (PR-7 commits 3..7), not the
// dispatcher's: each downstream write checks `(sellerId, transaction.id)`
// against `OrderFee.externalRef` / `OrgPeriodFee.externalRef` (Json column,
// pulls the transaction id into a `{ trendyolId: string }` shape on insert).
// The dispatcher itself is pure — no I/O, no Prisma.
//
// DeductionInvoices sub-classification uses the TR-localized
// `transactionType` field VALUE from the response (research §2.1 — query
// param is EN, response value is TR). Unknown labels degrade to
// `{ kind: 'unknown', raw }` so the worker can audit-log the row and a
// human can add the mapping later.

import type { OrderFeeDirection, OrderFeeType } from '@pazarsync/db';

import type {
  OtherFinancialTransactionType,
  SettlementTransactionType,
  TrendyolFinancialTransaction,
} from './settlements';

// ─── Settlement dispatch targets ────────────────────────────────────────

export type SettlementDispatchTarget =
  | {
      /** Sale / Discount / Coupon — update existing OrderItem fields directly. */
      kind: 'order_item_update';
      /** Maps to the specific OrderItem field group affected. */
      semantics: 'sale' | 'discount' | 'coupon';
    }
  | {
      /** Return + Provision/ManualRefund/SellerRevenue/Commission ± Cancel. */
      kind: 'order_fee_insert';
      feeType: OrderFeeType;
      direction: OrderFeeDirection;
    }
  | {
      /** DiscountCancel / CouponCancel — adjust the existing Discount/Coupon row. */
      kind: 'compensating';
      targetType: 'Discount' | 'Coupon';
    }
  | {
      /** TYDiscount / TYCoupon family — Trendyol-funded, no DB write needed. */
      kind: 'no_op';
      reason: 'ty_passthrough';
    };

export function classifySettlementTransaction(
  requestedType: SettlementTransactionType,
): SettlementDispatchTarget {
  switch (requestedType) {
    // ─── Item-level updates ──────────────────────────────────────────
    case 'Sale':
      return { kind: 'order_item_update', semantics: 'sale' };
    case 'Discount':
      return { kind: 'order_item_update', semantics: 'discount' };
    case 'Coupon':
      return { kind: 'order_item_update', semantics: 'coupon' };

    // ─── Compensating ────────────────────────────────────────────────
    case 'DiscountCancel':
      return { kind: 'compensating', targetType: 'Discount' };
    case 'CouponCancel':
      return { kind: 'compensating', targetType: 'Coupon' };

    // ─── Pass-through (Trendyol-funded) ──────────────────────────────
    case 'TYDiscount':
    case 'TYDiscountCancel':
    case 'TYCoupon':
    case 'TYCouponCancel':
      return { kind: 'no_op', reason: 'ty_passthrough' };

    // ─── OrderFee inserts ────────────────────────────────────────────
    // Direction follows design §5.2: + side records as CREDIT for the
    // seller, − side as DEBIT. Cancel variants invert the original.
    case 'Return':
      return { kind: 'order_fee_insert', feeType: 'REFUND_DEDUCTION', direction: 'DEBIT' };

    case 'ProvisionPositive':
      return { kind: 'order_fee_insert', feeType: 'PROVISION_ADJUSTMENT', direction: 'CREDIT' };
    case 'ProvisionNegative':
      return { kind: 'order_fee_insert', feeType: 'PROVISION_ADJUSTMENT', direction: 'DEBIT' };

    case 'ManualRefund':
      return { kind: 'order_fee_insert', feeType: 'MANUAL_REFUND', direction: 'DEBIT' };
    case 'ManualRefundCancel':
      return { kind: 'order_fee_insert', feeType: 'MANUAL_REFUND', direction: 'CREDIT' };

    case 'SellerRevenuePositive':
      return { kind: 'order_fee_insert', feeType: 'REVENUE_ADJUSTMENT', direction: 'CREDIT' };
    case 'SellerRevenueNegative':
      return { kind: 'order_fee_insert', feeType: 'REVENUE_ADJUSTMENT', direction: 'DEBIT' };
    case 'SellerRevenuePositiveCancel':
      return { kind: 'order_fee_insert', feeType: 'REVENUE_ADJUSTMENT', direction: 'DEBIT' };
    case 'SellerRevenueNegativeCancel':
      return { kind: 'order_fee_insert', feeType: 'REVENUE_ADJUSTMENT', direction: 'CREDIT' };

    case 'CommissionPositive':
      return { kind: 'order_fee_insert', feeType: 'COMMISSION_ADJUSTMENT', direction: 'DEBIT' };
    case 'CommissionNegative':
      return { kind: 'order_fee_insert', feeType: 'COMMISSION_ADJUSTMENT', direction: 'CREDIT' };
    case 'CommissionPositiveCancel':
      return { kind: 'order_fee_insert', feeType: 'COMMISSION_ADJUSTMENT', direction: 'CREDIT' };
    case 'CommissionNegativeCancel':
      return { kind: 'order_fee_insert', feeType: 'COMMISSION_ADJUSTMENT', direction: 'DEBIT' };

    default: {
      const _exhaustive: never = requestedType;
      throw new Error(`Unhandled settlement transactionType: ${String(_exhaustive)}`);
    }
  }
}

// ─── OtherFinancial dispatch targets ────────────────────────────────────

export type OtherFinancialDispatchTarget =
  | {
      /** PaymentOrder ("Ödeme") — triggers handlePaymentOrderEntry (PR-7 commit 5). */
      kind: 'payment_order_cycle';
    }
  | {
      /** Stoppage ("E-ticaret Stopajı") — period-level audit + ESTIMATE confirm. */
      kind: 'org_period_fee_audit';
      feeType: OrderFeeType;
    }
  | {
      /** DeductionInvoices — discriminate further via TR-localized response value. */
      kind: 'deduction_invoice';
      subClass: DeductionInvoiceSubClass;
    }
  | {
      /** V1 doesn't model these (research §4.1: 60-day window observed zero). */
      kind: 'audit_log_raw';
      transactionType: OtherFinancialTransactionType;
    };

/**
 * DeductionInvoices sub-classes — the TR-localized response
 * `transactionType` value discriminates which kind of deduction this row
 * represents (research §4.4 + design §5.2 line 1098..1108).
 */
export type DeductionInvoiceSubClass =
  | { kind: 'platform_service_fee' /* PSF — OrgPeriodFee PLATFORM_SERVICE + OrderFee confirm */ }
  | { kind: 'cargo_invoice' /* SHIPPING / RETURN_SHIPPING — PR-8 scope, dispatcher only tetik */ }
  | { kind: 'advertising' /* Reklam Bedeli — OrgPeriodFee ADVERTISING org-level */ }
  | {
      kind: 'commission_invoice'; /* Komisyon Faturası — CommissionInvoice synthesis (PR-7 commit 6) */
    }
  | {
      kind: 'penalty';
      feeType: OrderFeeType; /* PENALTY_DEFECTIVE / _WRONG_PRODUCT / _MISSING_PRODUCT / _LATE_DELIVERY / _SUPPLY_FAILURE */
    }
  | { kind: 'notification_fee' /* OrgPeriodFee NOTIFICATION_FEE */ }
  | {
      kind: 'unknown';
      raw: string; /* graceful degradation — audit-log only, human adds mapping */
    };

/**
 * TR-localized response `transactionType` value → DeductionInvoice
 * sub-class. Source-of-truth: research §4.4 + design §5.2 line 1098+.
 * Unknown labels return `{ kind: 'unknown', raw }` so the worker can
 * audit-log the row without crashing on a new vendor label.
 */
const DEDUCTION_INVOICE_LABELS = new Map<string, DeductionInvoiceSubClass>([
  ['Platform Hizmet Bedeli', { kind: 'platform_service_fee' }],
  ['Kargo Fatura', { kind: 'cargo_invoice' }],
  ['Kargo Faturası', { kind: 'cargo_invoice' }], // both spellings observed
  ['Reklam Bedeli', { kind: 'advertising' }],
  ['Komisyon Faturası', { kind: 'commission_invoice' }],
  ['Kusurlu Ürün Faturası', { kind: 'penalty', feeType: 'PENALTY_DEFECTIVE' }],
  ['Yanlış Ürün Faturası', { kind: 'penalty', feeType: 'PENALTY_WRONG_PRODUCT' }],
  ['Eksik Ürün Faturası', { kind: 'penalty', feeType: 'PENALTY_MISSING_PRODUCT' }],
  ['Termin Gecikme Bedeli', { kind: 'penalty', feeType: 'PENALTY_LATE_DELIVERY' }],
  ['Tedarik Edememe Faturası', { kind: 'penalty', feeType: 'PENALTY_SUPPLY_FAILURE' }],
  ['Müşteri Duyuruları Faturası', { kind: 'notification_fee' }],
]);

export function classifyDeductionInvoice(
  responseTransactionType: string,
): DeductionInvoiceSubClass {
  return (
    DEDUCTION_INVOICE_LABELS.get(responseTransactionType) ?? {
      kind: 'unknown',
      raw: responseTransactionType,
    }
  );
}

/**
 * Classify an /otherfinancials row by REQUEST transactionType (+ response
 * transactionType for DeductionInvoices sub-classification).
 *
 * The transaction row is required for DeductionInvoices because the
 * sub-class is encoded in the response field value, not the request param.
 * For all other types the row is unused by classification (handlers
 * consume it for the actual write).
 */
/**
 * PR-8: kargo faturasi tespiti — cron'un TX-DISI pre-fetch karari icin.
 * DeductionInvoices satirinin TR-localized transactionType'i "Kargo Fatura(si)"
 * ise fatura seri numarasini (row.id) dondurur; degilse null. Cron bu satiri
 * dispatcher'a GONDERMEZ: once cargo-invoice/{serial}/items'i ag uzerinden
 * ceker (transaction disinda), sonra handleCargoInvoiceItems ile tx icinde
 * isler. Dispatcher'in cargo_invoice dali yalniz guvenlik logu olarak kalir.
 */
export function getCargoInvoiceSerial(
  requestedType: OtherFinancialTransactionType,
  row: TrendyolFinancialTransaction,
): string | null {
  if (requestedType !== 'DeductionInvoices') return null;
  const subClass = classifyDeductionInvoice(row.transactionType);
  return subClass.kind === 'cargo_invoice' ? row.id : null;
}

export function classifyOtherFinancialTransaction(
  requestedType: OtherFinancialTransactionType,
  row: TrendyolFinancialTransaction,
): OtherFinancialDispatchTarget {
  switch (requestedType) {
    case 'PaymentOrder':
      return { kind: 'payment_order_cycle' };

    case 'Stoppage':
      return { kind: 'org_period_fee_audit', feeType: 'STOPPAGE' };

    case 'DeductionInvoices':
      return { kind: 'deduction_invoice', subClass: classifyDeductionInvoice(row.transactionType) };

    // V1 unmodelled types (research §4.1 — 60-day window observed zero).
    // Worker audit-logs but does not write to a structured table; admin
    // adds mapping when first encountered.
    case 'CashAdvance':
    case 'WireTransfer':
    case 'IncomingTransfer':
    case 'ReturnInvoice':
    case 'CommissionAgreementInvoice':
    case 'FinancialItem':
      return { kind: 'audit_log_raw', transactionType: requestedType };

    default: {
      const _exhaustive: never = requestedType;
      throw new Error(`Unhandled otherfinancial transactionType: ${String(_exhaustive)}`);
    }
  }
}
