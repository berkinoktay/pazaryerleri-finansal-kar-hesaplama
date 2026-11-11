/**
 * Cargo-invoice detection unit tests.
 *
 * Pure tests — no I/O, no Prisma. Every documented DeductionInvoices
 * sub-class label round-trips to the right discriminated-union variant,
 * and getCargoInvoiceSerial returns the row id only for a DeductionInvoices
 * cargo invoice row.
 */

import { describe, expect, it } from 'vitest';

import {
  classifyDeductionInvoice,
  getCargoInvoiceSerial,
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

// ─── Cargo invoice serial ────────────────────────────────────────────────

describe('getCargoInvoiceSerial', () => {
  it.each(['Kargo Fatura', 'Kargo Faturası'])(
    'DeductionInvoices row labelled "%s" returns the row id as the serial',
    (label) => {
      const row = makeTransaction({ id: 'DDF2026013132324', transactionType: label });
      expect(getCargoInvoiceSerial('DeductionInvoices', row)).toBe('DDF2026013132324');
    },
  );

  it('DeductionInvoices row with a non-cargo label returns null', () => {
    const row = makeTransaction({ transactionType: 'Platform Hizmet Bedeli' });
    expect(getCargoInvoiceSerial('DeductionInvoices', row)).toBeNull();
  });

  it('DeductionInvoices row with an unknown label returns null', () => {
    const row = makeTransaction({ transactionType: 'Yeni Bir Trendyol Kategorisi' });
    expect(getCargoInvoiceSerial('DeductionInvoices', row)).toBeNull();
  });

  it.each(['PaymentOrder', 'Stoppage', 'ReturnInvoice'] as const)(
    '%s row returns null even when its label reads as a cargo invoice',
    (requestedType) => {
      const row = makeTransaction({ transactionType: 'Kargo Fatura' });
      expect(getCargoInvoiceSerial(requestedType, row)).toBeNull();
    },
  );
});
