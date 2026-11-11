import {
  OTHER_FINANCIAL_TRANSACTION_TYPES,
  SETTLEMENT_TRANSACTION_TYPES,
} from '@pazarsync/marketplace';
import { describe, expect, it } from 'vitest';

import {
  isTrendyolTransactionType,
  TRENDYOL_CARGO_OUTBOUND_ITEM_TYPE,
  TRENDYOL_CARGO_RETURN_ITEM_TYPE,
  TRENDYOL_OTHER_FINANCIAL_RECORD_KIND,
  TRENDYOL_PACKAGELESS_BINDABLE_TYPES,
  TRENDYOL_SETTLEMENT_RECORD_KIND,
} from '../settlement-records';

describe('TRENDYOL record kind tables', () => {
  it('classifies every Trendyol settlement and other-financial type', () => {
    expect(Object.keys(TRENDYOL_SETTLEMENT_RECORD_KIND).sort()).toEqual(
      [...SETTLEMENT_TRANSACTION_TYPES].sort(),
    );
    expect(Object.keys(TRENDYOL_OTHER_FINANCIAL_RECORD_KIND).sort()).toEqual(
      [...OTHER_FINANCIAL_TRANSACTION_TYPES].sort(),
    );
  });

  it('pins the ignored and period kinds', () => {
    const typesWithKind = (kind: string): string[] =>
      Object.entries(TRENDYOL_OTHER_FINANCIAL_RECORD_KIND)
        .filter(([, value]) => value === kind)
        .map(([type]) => type)
        .sort();
    expect(typesWithKind('IGNORED')).toEqual(['CashAdvance', 'IncomingTransfer', 'WireTransfer']);
    expect(typesWithKind('PERIOD')).toEqual(['DeductionInvoices', 'Stoppage']);
  });

  it('spells the cargo item types as the Trendyol Turkish labels', () => {
    // Unicode escapes keep the source ASCII; they decode to the exact Trendyol
    // invoice labels 'Gonderi Kargo Bedeli' / 'Iade Kargo Bedeli' (with the
    // Turkish 'o' umlaut and dotted capital 'I').
    expect(TRENDYOL_CARGO_OUTBOUND_ITEM_TYPE).toBe('G\u00f6nderi Kargo Bedeli');
    expect(TRENDYOL_CARGO_RETURN_ITEM_TYPE).toBe('\u0130ade Kargo Bedeli');
  });

  it('keeps the cargo labels byte-identical to the legacy UTF-8 labels', () => {
    // The sync-worker cargo-invoice matcher keys off these exact bytes; the outbound
    // label starts 47c3b6 (G + the 'o' umlaut), the return label starts c4b0 (the
    // dotted capital 'I'). A drift here would silently stop matching cargo fees.
    const outboundHex = Buffer.from(TRENDYOL_CARGO_OUTBOUND_ITEM_TYPE, 'utf8').toString('hex');
    const returnHex = Buffer.from(TRENDYOL_CARGO_RETURN_ITEM_TYPE, 'utf8').toString('hex');
    expect(outboundHex.startsWith('47c3b6')).toBe(true);
    expect(outboundHex).toBe('47c3b66e64657269204b6172676f20426564656c69');
    expect(returnHex).toBe('c4b0616465204b6172676f20426564656c69');
  });

  it('derives the package-less bindable types from the kind table (return legs only)', () => {
    // Only return-leg types ever arrive without a package, so a package-less row binds by
    // order number + barcode only for these. Derived from the kind table, so a future kind
    // change flows through here without a hand-maintained duplicate list.
    expect([...TRENDYOL_PACKAGELESS_BINDABLE_TYPES].sort()).toEqual(
      ['CouponCancel', 'DiscountCancel', 'Return'].sort(),
    );
    for (const type of TRENDYOL_PACKAGELESS_BINDABLE_TYPES) {
      expect(['RETURN', 'DISCOUNT_REVERSAL']).toContain(TRENDYOL_SETTLEMENT_RECORD_KIND[type]);
    }
  });

  it('narrows a known transaction type and rejects unknown and prototype keys', () => {
    expect(isTrendyolTransactionType('Sale')).toBe(true);
    expect(isTrendyolTransactionType('PaymentOrder')).toBe(true);
    expect(isTrendyolTransactionType('NotARealType')).toBe(false);
    // A prototype key must never be mistaken for a transaction type.
    expect(isTrendyolTransactionType('toString')).toBe(false);
  });

  it('spells the Trendyol-funded discount and coupon types with the finance doc casing', () => {
    // The Trendyol finance API is case-sensitive: TyDiscount -> 200, TYDiscount -> 400.
    for (const type of ['TyDiscount', 'TyDiscountCancel', 'TyCoupon', 'TyCouponCancel']) {
      expect(isTrendyolTransactionType(type)).toBe(true);
    }
    for (const type of ['TYDiscount', 'TYDiscountCancel', 'TYCoupon', 'TYCouponCancel']) {
      expect(isTrendyolTransactionType(type)).toBe(false);
    }
  });
});
