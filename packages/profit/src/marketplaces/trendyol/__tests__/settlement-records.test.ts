import {
  OTHER_FINANCIAL_TRANSACTION_TYPES,
  SETTLEMENT_TRANSACTION_TYPES,
} from '@pazarsync/marketplace';
import { describe, expect, it } from 'vitest';

import {
  TRENDYOL_CARGO_OUTBOUND_ITEM_TYPE,
  TRENDYOL_CARGO_RETURN_ITEM_TYPE,
  TRENDYOL_OTHER_FINANCIAL_RECORD_KIND,
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
    expect(TRENDYOL_CARGO_OUTBOUND_ITEM_TYPE).toBe('Gönderi Kargo Bedeli');
    expect(TRENDYOL_CARGO_RETURN_ITEM_TYPE).toBe('İade Kargo Bedeli');
  });
});
