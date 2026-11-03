import { type Decimal } from 'decimal.js';
import { ProfitLineType } from '@pazarsync/db/enums';
import type {
  OtherFinancialTransactionType,
  SettlementTransactionType,
} from '@pazarsync/marketplace';

/**
 * Every Trendyol settlement or otherfinancials transaction type. The two
 * marketplace unions are kept separate so each kind table below can be checked
 * for completeness against its own source union.
 */
export type TrendyolTransactionType = SettlementTransactionType | OtherFinancialTransactionType;

/**
 * How the mapper treats a record:
 * - SALE / DISCOUNT / RETURN: order-item records that build actual profit lines.
 * - DISCOUNT_REVERSAL: DiscountCancel and CouponCancel; give a discount or coupon back
 *   when the item is cancelled or returned.
 * - PAYMENT_ORDER: a cycle marker that confirms estimates (no line of its own).
 * - PERIOD: a period-level record with no order key; set aside for the period epic.
 * - IGNORED: a cash movement, neither income nor expense.
 * - UNVERIFIED: a type whose line mapping is not yet confirmed with live data; it
 *   raises a non-blocking warning instead of a line.
 */
export type TrendyolRecordKind =
  | 'SALE'
  | 'DISCOUNT'
  | 'RETURN'
  | 'DISCOUNT_REVERSAL'
  | 'PAYMENT_ORDER'
  | 'PERIOD'
  | 'IGNORED'
  | 'UNVERIFIED';

/**
 * Settlement (`/settlements`) transaction types. Sale, Discount, Coupon, Return and the
 * two reversals (DiscountCancel, CouponCancel) build lines: a Coupon is a debt that nets
 * out of the sale like a Discount, and a reversal gives a discount or coupon back on a
 * cancel or return (confirmed with live data, 3 Nov 2026). Every other type stays
 * UNVERIFIED (plan decision 15) until its mapping is confirmed with live data. The
 * `satisfies Record<...>` forces the table to cover every member of the marketplace union.
 */
export const TRENDYOL_SETTLEMENT_RECORD_KIND = {
  Sale: 'SALE',
  Return: 'RETURN',
  Discount: 'DISCOUNT',
  DiscountCancel: 'DISCOUNT_REVERSAL',
  Coupon: 'DISCOUNT',
  CouponCancel: 'DISCOUNT_REVERSAL',
  ProvisionPositive: 'UNVERIFIED',
  ProvisionNegative: 'UNVERIFIED',
  ManualRefund: 'UNVERIFIED',
  ManualRefundCancel: 'UNVERIFIED',
  TYDiscount: 'UNVERIFIED',
  TYDiscountCancel: 'UNVERIFIED',
  TYCoupon: 'UNVERIFIED',
  TYCouponCancel: 'UNVERIFIED',
  SellerRevenuePositive: 'UNVERIFIED',
  SellerRevenueNegative: 'UNVERIFIED',
  CommissionPositive: 'UNVERIFIED',
  CommissionNegative: 'UNVERIFIED',
  SellerRevenuePositiveCancel: 'UNVERIFIED',
  SellerRevenueNegativeCancel: 'UNVERIFIED',
  CommissionPositiveCancel: 'UNVERIFIED',
  CommissionNegativeCancel: 'UNVERIFIED',
} as const satisfies Record<SettlementTransactionType, TrendyolRecordKind>;

/**
 * Otherfinancials (`/otherfinancials`) transaction types.
 * - Stoppage and DeductionInvoices are period-level (the period epic consumes them).
 * - CashAdvance, WireTransfer and IncomingTransfer are cash movements (early
 *   payment, outgoing wire, incoming payment). Per the Trendyol docs these move
 *   money the seller already earned; they are neither income nor expense, so they
 *   produce nothing.
 * - ReturnInvoice, CommissionAgreementInvoice and FinancialItem stay UNVERIFIED.
 */
export const TRENDYOL_OTHER_FINANCIAL_RECORD_KIND = {
  Stoppage: 'PERIOD',
  CashAdvance: 'IGNORED',
  WireTransfer: 'IGNORED',
  IncomingTransfer: 'IGNORED',
  ReturnInvoice: 'UNVERIFIED',
  CommissionAgreementInvoice: 'UNVERIFIED',
  PaymentOrder: 'PAYMENT_ORDER',
  DeductionInvoices: 'PERIOD',
  FinancialItem: 'UNVERIFIED',
} as const satisfies Record<OtherFinancialTransactionType, TrendyolRecordKind>;

/** The merged kind table over every Trendyol transaction type. */
export const TRENDYOL_RECORD_KIND = {
  ...TRENDYOL_SETTLEMENT_RECORD_KIND,
  ...TRENDYOL_OTHER_FINANCIAL_RECORD_KIND,
} satisfies Record<TrendyolTransactionType, TrendyolRecordKind>;

/**
 * The otherfinancials transaction type that marks a settlement cycle's payment
 * order (its kind is PAYMENT_ORDER in TRENDYOL_OTHER_FINANCIAL_RECORD_KIND). Named
 * so the loader query and the mapper's rawType never write the raw literal.
 */
export const TRENDYOL_PAYMENT_ORDER_TRANSACTION_TYPE: OtherFinancialTransactionType =
  'PaymentOrder';

/**
 * The cargo-invoice item type for an outbound shipment, the Trendyol Turkish label
 * 'Gonderi Kargo Bedeli' (with the 'o' umlaut). Written with a unicode escape to
 * keep the source ASCII; the runtime string is byte-identical to the legacy label.
 */
export const TRENDYOL_CARGO_OUTBOUND_ITEM_TYPE = 'G\u00f6nderi Kargo Bedeli';

/**
 * The cargo-invoice item type for a return shipment, the Trendyol Turkish label
 * 'Iade Kargo Bedeli' (with the dotted capital 'I'). Written with a unicode escape
 * to keep the source ASCII; the runtime string is byte-identical to the legacy label.
 */
export const TRENDYOL_CARGO_RETURN_ITEM_TYPE = '\u0130ade Kargo Bedeli';

/** Estimate line types that the sale payment order confirms (plan decision 14). */
export const TRENDYOL_SALE_CYCLE_CONFIRMED_TYPES: readonly ProfitLineType[] = [
  ProfitLineType.SERVICE_FEE,
  ProfitLineType.STOPPAGE,
  ProfitLineType.INTERNATIONAL_SERVICE_FEE,
];

/** Estimate line types that the return payment order confirms (plan decision 9). */
export const TRENDYOL_RETURN_CYCLE_CONFIRMED_TYPES: readonly ProfitLineType[] = [
  ProfitLineType.STOPPAGE_REFUND,
  ProfitLineType.INTERNATIONAL_OPERATION_FEE,
];

/**
 * A single Trendyol settlement / otherfinancials row, normalized for the mapper.
 * Money is VAT included and in Turkish lira.
 */
export interface TrendyolSettlementRecord {
  readonly recordId: string;
  readonly transactionType: TrendyolTransactionType;
  readonly barcode: string | null;
  readonly debt: Decimal;
  readonly credit: Decimal;
  readonly commissionAmount: Decimal | null;
  readonly paymentOrderId: string | null;
}

/** A single cargo-invoice line item. `amountGross` is VAT included. */
export interface TrendyolCargoInvoiceItem {
  readonly invoiceSerial: string;
  readonly parcelUniqueId: string;
  readonly itemType: string;
  readonly amountGross: Decimal;
  readonly desi: Decimal | null;
}

/** The record's kind; a plain lookup in the merged kind table. */
export function recordKind(record: TrendyolSettlementRecord): TrendyolRecordKind {
  return TRENDYOL_RECORD_KIND[record.transactionType];
}

/**
 * Narrows a raw transaction-type string to a known `TrendyolTransactionType` by
 * an own-property check on the merged kind table -- so a prototype key such as
 * `'toString'` is never mistaken for a transaction type. The loader uses it to
 * tell a mappable settlement/otherfinancials row from one it must set aside.
 */
export function isTrendyolTransactionType(value: string): value is TrendyolTransactionType {
  return Object.hasOwn(TRENDYOL_RECORD_KIND, value);
}
