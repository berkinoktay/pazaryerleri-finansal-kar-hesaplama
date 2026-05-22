/**
 * PR-7 commit 2 — Transaction dispatcher unit tests.
 *
 * Pure classification tests — no I/O, no Prisma. Every settlement
 * transactionType + every otherfinancials transactionType + every
 * documented DeductionInvoices sub-class round-trips to the right
 * discriminated-union variant.
 */

import { describe, expect, it } from 'vitest';

import {
  classifyDeductionInvoice,
  classifyOtherFinancialTransaction,
  classifySettlementTransaction,
  type DeductionInvoiceSubClass,
  type TrendyolFinancialTransaction,
} from '@pazarsync/marketplace';

function makeTransaction(
  overrides: Partial<TrendyolFinancialTransaction> = {},
): TrendyolFinancialTransaction {
  return {
    id: '999',
    transactionDate: 1715000000000,
    barcode: null,
    transactionType: 'Satış',
    receiptId: null,
    description: null,
    debt: 0,
    credit: 0,
    paymentPeriod: null,
    commissionRate: null,
    commissionAmount: null,
    commissionInvoiceSerialNumber: null,
    sellerRevenue: null,
    orderNumber: null,
    paymentOrderId: null,
    paymentDate: null,
    sellerId: 123456,
    storeId: null,
    storeName: null,
    storeAddress: null,
    country: 'Türkiye',
    orderDate: null,
    affiliate: 'TRENDYOLTR',
    shipmentPackageId: null,
    ...overrides,
  };
}

// ─── Settlement dispatcher ────────────────────────────────────────────────

describe('classifySettlementTransaction — item-level', () => {
  it('Sale → order_item_update / sale', () => {
    expect(classifySettlementTransaction('Sale')).toEqual({
      kind: 'order_item_update',
      semantics: 'sale',
    });
  });

  it('Discount → order_item_update / discount', () => {
    expect(classifySettlementTransaction('Discount')).toEqual({
      kind: 'order_item_update',
      semantics: 'discount',
    });
  });

  it('Coupon → order_item_update / coupon', () => {
    expect(classifySettlementTransaction('Coupon')).toEqual({
      kind: 'order_item_update',
      semantics: 'coupon',
    });
  });
});

describe('classifySettlementTransaction — compensating', () => {
  it('DiscountCancel → compensating / Discount', () => {
    expect(classifySettlementTransaction('DiscountCancel')).toEqual({
      kind: 'compensating',
      targetType: 'Discount',
    });
  });

  it('CouponCancel → compensating / Coupon', () => {
    expect(classifySettlementTransaction('CouponCancel')).toEqual({
      kind: 'compensating',
      targetType: 'Coupon',
    });
  });
});

describe('classifySettlementTransaction — TY pass-through', () => {
  it.each(['TYDiscount', 'TYDiscountCancel', 'TYCoupon', 'TYCouponCancel'] as const)(
    '%s → no_op / ty_passthrough',
    (type) => {
      expect(classifySettlementTransaction(type)).toEqual({
        kind: 'no_op',
        reason: 'ty_passthrough',
      });
    },
  );
});

describe('classifySettlementTransaction — OrderFee insert (feeType + direction)', () => {
  it('Return → REFUND_DEDUCTION / DEBIT', () => {
    expect(classifySettlementTransaction('Return')).toEqual({
      kind: 'order_fee_insert',
      feeType: 'REFUND_DEDUCTION',
      direction: 'DEBIT',
    });
  });

  it('ProvisionPositive → PROVISION_ADJUSTMENT / CREDIT', () => {
    expect(classifySettlementTransaction('ProvisionPositive')).toEqual({
      kind: 'order_fee_insert',
      feeType: 'PROVISION_ADJUSTMENT',
      direction: 'CREDIT',
    });
  });

  it('ProvisionNegative → PROVISION_ADJUSTMENT / DEBIT', () => {
    expect(classifySettlementTransaction('ProvisionNegative')).toEqual({
      kind: 'order_fee_insert',
      feeType: 'PROVISION_ADJUSTMENT',
      direction: 'DEBIT',
    });
  });

  it('ManualRefund → MANUAL_REFUND / DEBIT', () => {
    expect(classifySettlementTransaction('ManualRefund')).toEqual({
      kind: 'order_fee_insert',
      feeType: 'MANUAL_REFUND',
      direction: 'DEBIT',
    });
  });

  it('ManualRefundCancel → MANUAL_REFUND / CREDIT', () => {
    expect(classifySettlementTransaction('ManualRefundCancel')).toEqual({
      kind: 'order_fee_insert',
      feeType: 'MANUAL_REFUND',
      direction: 'CREDIT',
    });
  });

  it('SellerRevenuePositive / Cancel → REVENUE_ADJUSTMENT inverted directions', () => {
    expect(classifySettlementTransaction('SellerRevenuePositive')).toEqual({
      kind: 'order_fee_insert',
      feeType: 'REVENUE_ADJUSTMENT',
      direction: 'CREDIT',
    });
    expect(classifySettlementTransaction('SellerRevenuePositiveCancel')).toEqual({
      kind: 'order_fee_insert',
      feeType: 'REVENUE_ADJUSTMENT',
      direction: 'DEBIT',
    });
  });

  it('SellerRevenueNegative / Cancel → REVENUE_ADJUSTMENT inverted directions', () => {
    expect(classifySettlementTransaction('SellerRevenueNegative')).toEqual({
      kind: 'order_fee_insert',
      feeType: 'REVENUE_ADJUSTMENT',
      direction: 'DEBIT',
    });
    expect(classifySettlementTransaction('SellerRevenueNegativeCancel')).toEqual({
      kind: 'order_fee_insert',
      feeType: 'REVENUE_ADJUSTMENT',
      direction: 'CREDIT',
    });
  });

  it('CommissionPositive / Cancel → COMMISSION_ADJUSTMENT inverted directions', () => {
    expect(classifySettlementTransaction('CommissionPositive')).toEqual({
      kind: 'order_fee_insert',
      feeType: 'COMMISSION_ADJUSTMENT',
      direction: 'DEBIT',
    });
    expect(classifySettlementTransaction('CommissionPositiveCancel')).toEqual({
      kind: 'order_fee_insert',
      feeType: 'COMMISSION_ADJUSTMENT',
      direction: 'CREDIT',
    });
  });

  it('CommissionNegative / Cancel → COMMISSION_ADJUSTMENT inverted directions', () => {
    expect(classifySettlementTransaction('CommissionNegative')).toEqual({
      kind: 'order_fee_insert',
      feeType: 'COMMISSION_ADJUSTMENT',
      direction: 'CREDIT',
    });
    expect(classifySettlementTransaction('CommissionNegativeCancel')).toEqual({
      kind: 'order_fee_insert',
      feeType: 'COMMISSION_ADJUSTMENT',
      direction: 'DEBIT',
    });
  });
});

// ─── OtherFinancial dispatcher ────────────────────────────────────────────

describe('classifyOtherFinancialTransaction', () => {
  it('PaymentOrder → payment_order_cycle', () => {
    expect(classifyOtherFinancialTransaction('PaymentOrder', makeTransaction())).toEqual({
      kind: 'payment_order_cycle',
    });
  });

  it('Stoppage → org_period_fee_audit / STOPPAGE', () => {
    expect(classifyOtherFinancialTransaction('Stoppage', makeTransaction())).toEqual({
      kind: 'org_period_fee_audit',
      feeType: 'STOPPAGE',
    });
  });

  it.each([
    'CashAdvance',
    'WireTransfer',
    'IncomingTransfer',
    'ReturnInvoice',
    'CommissionAgreementInvoice',
    'FinancialItem',
  ] as const)('%s → audit_log_raw', (type) => {
    expect(classifyOtherFinancialTransaction(type, makeTransaction())).toEqual({
      kind: 'audit_log_raw',
      transactionType: type,
    });
  });

  it('DeductionInvoices → deduction_invoice with sub-class from response value', () => {
    const result = classifyOtherFinancialTransaction(
      'DeductionInvoices',
      makeTransaction({ transactionType: 'Platform Hizmet Bedeli' }),
    );
    expect(result).toEqual({
      kind: 'deduction_invoice',
      subClass: { kind: 'platform_service_fee' },
    });
  });
});

// ─── DeductionInvoices sub-class lookup ──────────────────────────────────

describe('classifyDeductionInvoice', () => {
  const cases: ReadonlyArray<[string, DeductionInvoiceSubClass]> = [
    ['Platform Hizmet Bedeli', { kind: 'platform_service_fee' }],
    ['Kargo Fatura', { kind: 'cargo_invoice' }],
    ['Kargo Faturası', { kind: 'cargo_invoice' }],
    ['Reklam Bedeli', { kind: 'advertising' }],
    ['Komisyon Faturası', { kind: 'commission_invoice' }],
    ['Kusurlu Ürün Faturası', { kind: 'penalty', feeType: 'PENALTY_DEFECTIVE' }],
    ['Yanlış Ürün Faturası', { kind: 'penalty', feeType: 'PENALTY_WRONG_PRODUCT' }],
    ['Eksik Ürün Faturası', { kind: 'penalty', feeType: 'PENALTY_MISSING_PRODUCT' }],
    ['Termin Gecikme Bedeli', { kind: 'penalty', feeType: 'PENALTY_LATE_DELIVERY' }],
    ['Tedarik Edememe Faturası', { kind: 'penalty', feeType: 'PENALTY_SUPPLY_FAILURE' }],
    ['Müşteri Duyuruları Faturası', { kind: 'notification_fee' }],
  ];

  it.each(cases)('"%s" → expected sub-class', (label, expected) => {
    expect(classifyDeductionInvoice(label)).toEqual(expected);
  });

  it('unknown label → { kind: "unknown", raw } graceful degradation', () => {
    expect(classifyDeductionInvoice('Yeni Bir Trendyol Kategorisi')).toEqual({
      kind: 'unknown',
      raw: 'Yeni Bir Trendyol Kategorisi',
    });
  });

  it('empty string → unknown / empty raw', () => {
    expect(classifyDeductionInvoice('')).toEqual({
      kind: 'unknown',
      raw: '',
    });
  });
});
