/**
 * Unit tests for the pure Trendyol finance-record builders (Phase 3B, Gorev 6).
 * They pin that the record type comes from the requested filter type (not the
 * Turkish response label), that numeric ids and money are converted exactly, that
 * the cargo record id and invoice-serial rules hold, and that the full vendor
 * object is preserved in the payload.
 */

import { Decimal } from 'decimal.js';
import { FinanceRecordFamily } from '@pazarsync/db/enums';
import type { CargoInvoiceItem, TrendyolFinancialTransaction } from '@pazarsync/marketplace';
import { describe, expect, it } from 'vitest';

import {
  trendyolCargoInvoiceItemInputs,
  trendyolOtherFinancialRecordInput,
  trendyolSettlementRecordInput,
} from '../finance-record-inputs';

const TX_MS = Date.parse('2026-10-28T09:00:00.000Z');

/** A full Trendyol financial transaction row, so each test overrides only what it needs. */
const BASE_TX: TrendyolFinancialTransaction = {
  id: 'rec-1',
  transactionDate: TX_MS,
  barcode: null,
  transactionType: 'Satis',
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
  sellerId: 1,
  storeId: null,
  storeName: null,
  storeAddress: null,
  country: 'TR',
  orderDate: null,
  affiliate: '',
  shipmentPackageId: null,
};

function financialTx(
  overrides: Partial<TrendyolFinancialTransaction> & { readonly id: string },
): TrendyolFinancialTransaction {
  return { ...BASE_TX, ...overrides };
}

const BASE_CARGO: CargoInvoiceItem = {
  shipmentPackageType: 'Gonderi Kargo Bedeli',
  parcelUniqueId: 0,
  orderNumber: '',
  amount: 0,
  desi: 0,
};

function cargoItem(overrides: Partial<CargoInvoiceItem>): CargoInvoiceItem {
  return { ...BASE_CARGO, ...overrides };
}

describe('trendyolSettlementRecordInput', () => {
  it('takes the transaction type from the requested filter, not the Turkish label', () => {
    const row = financialTx({ id: 'sale-1', transactionType: 'Satis' });
    const input = trendyolSettlementRecordInput('Sale', row);
    expect(input.family).toBe(FinanceRecordFamily.SETTLEMENT);
    expect(input.transactionType).toBe('Sale');
  });

  it('converts the numeric ids to strings', () => {
    const row = financialTx({
      id: 'sale-1',
      shipmentPackageId: 1234567890123,
      paymentOrderId: 58450612,
    });
    const input = trendyolSettlementRecordInput('Sale', row);
    expect(input.recordId).toBe('sale-1');
    expect(input.shipmentPackageId).toBe('1234567890123');
    expect(input.paymentOrderId).toBe('58450612');
    expect(input.parcelUniqueId).toBeNull();
  });

  it('reads the money columns as decimals and leaves null null', () => {
    const row = financialTx({ id: 'sale-1', debt: 37.72, credit: 529, commissionAmount: 100.51 });
    const input = trendyolSettlementRecordInput('Sale', row);
    expect(input.debt).toBeInstanceOf(Decimal);
    expect(input.debt?.toFixed(2)).toBe('37.72');
    expect(input.credit?.toFixed(2)).toBe('529.00');
    expect(input.commissionAmount?.toFixed(2)).toBe('100.51');
    // Cargo-only columns stay null on a settlement record.
    expect(input.amountGross).toBeNull();
    expect(input.desi).toBeNull();

    const missing = trendyolSettlementRecordInput('Sale', financialTx({ id: 'sale-2' }));
    expect(missing.commissionAmount).toBeNull();
  });

  it('carries the commission invoice serial', () => {
    const row = financialTx({ id: 'sale-1', commissionInvoiceSerialNumber: 'CIS-9' });
    expect(trendyolSettlementRecordInput('Sale', row).invoiceSerial).toBe('CIS-9');
    expect(
      trendyolSettlementRecordInput('Sale', financialTx({ id: 'sale-2' })).invoiceSerial,
    ).toBeNull();
  });

  it('carries the transaction date as a Date at the vendor epoch', () => {
    const input = trendyolSettlementRecordInput('Sale', financialTx({ id: 'sale-1' }));
    expect(input.transactionDate).toBeInstanceOf(Date);
    expect(input.transactionDate?.getTime()).toBe(TX_MS);
  });

  it('preserves the full vendor object in the payload', () => {
    const row = financialTx({
      id: 'sale-1',
      transactionType: 'Satis',
      orderNumber: 'ORD-1',
      debt: 37.72,
    });
    const input = trendyolSettlementRecordInput('Sale', row);
    // The Turkish response label survives only in the payload, never in transactionType.
    expect(input.payload).toEqual(row);
    expect(input.orderNumber).toBe('ORD-1');
  });
});

describe('trendyolOtherFinancialRecordInput', () => {
  it('takes the transaction type from the requested filter and sets the family', () => {
    const row = financialTx({ id: 'po-1', transactionType: 'Odeme' });
    const input = trendyolOtherFinancialRecordInput('PaymentOrder', row);
    expect(input.family).toBe(FinanceRecordFamily.OTHER_FINANCIAL);
    expect(input.transactionType).toBe('PaymentOrder');
  });

  it('uses the row id as the invoice serial for a deduction invoice', () => {
    const row = financialTx({ id: 'ded-7', transactionType: 'Platform Hizmet Bedeli' });
    expect(trendyolOtherFinancialRecordInput('DeductionInvoices', row).invoiceSerial).toBe('ded-7');
    // A non-deduction other-financial row keeps the commission-invoice-serial rule.
    const po = financialTx({ id: 'po-1', commissionInvoiceSerialNumber: 'CIS-3' });
    expect(trendyolOtherFinancialRecordInput('PaymentOrder', po).invoiceSerial).toBe('CIS-3');
  });

  it('converts the payment order id to a string', () => {
    const row = financialTx({ id: 'po-1', paymentOrderId: 58450612 });
    expect(trendyolOtherFinancialRecordInput('PaymentOrder', row).paymentOrderId).toBe('58450612');
  });
});

describe('trendyolCargoInvoiceItemInputs', () => {
  const invoiceRow = financialTx({
    id: 'INV-1',
    transactionType: 'Kargo Fatura',
    transactionDate: TX_MS,
  });

  it('builds the record id from the invoice serial and the parcel unique id', () => {
    const [input] = trendyolCargoInvoiceItemInputs(invoiceRow, [
      cargoItem({ parcelUniqueId: 7788990011 }),
    ]);
    if (input === undefined) throw new Error('expected one cargo record input');
    expect(input.family).toBe(FinanceRecordFamily.CARGO_INVOICE_ITEM);
    expect(input.recordId).toBe('INV-1:7788990011');
    expect(input.invoiceSerial).toBe('INV-1');
    expect(input.parcelUniqueId).toBe('7788990011');
  });

  it('takes the transaction type from the item label and fills amount and desi', () => {
    const [input] = trendyolCargoInvoiceItemInputs(invoiceRow, [
      cargoItem({
        shipmentPackageType: 'Iade Kargo Bedeli',
        parcelUniqueId: 42,
        amount: 98.34,
        desi: 2,
        orderNumber: 'ORD-9',
      }),
    ]);
    if (input === undefined) throw new Error('expected one cargo record input');
    expect(input.transactionType).toBe('Iade Kargo Bedeli');
    expect(input.amountGross?.toFixed(2)).toBe('98.34');
    expect(input.desi?.toFixed(2)).toBe('2.00');
    expect(input.orderNumber).toBe('ORD-9');
    // Settlement-only money columns stay null on a cargo record.
    expect(input.debt).toBeNull();
    expect(input.credit).toBeNull();
    expect(input.commissionAmount).toBeNull();
  });

  it('takes the transaction date from the invoice row and preserves the item payload', () => {
    const item = cargoItem({ parcelUniqueId: 42, amount: 98.34, desi: 2, orderNumber: 'ORD-9' });
    const [input] = trendyolCargoInvoiceItemInputs(invoiceRow, [item]);
    if (input === undefined) throw new Error('expected one cargo record input');
    expect(input.transactionDate?.getTime()).toBe(TX_MS);
    expect(input.payload).toEqual(item);
  });

  it('maps every item of the invoice', () => {
    const inputs = trendyolCargoInvoiceItemInputs(invoiceRow, [
      cargoItem({ parcelUniqueId: 1 }),
      cargoItem({ parcelUniqueId: 2 }),
    ]);
    expect(inputs.map((input) => input.recordId)).toEqual(['INV-1:1', 'INV-1:2']);
  });
});
