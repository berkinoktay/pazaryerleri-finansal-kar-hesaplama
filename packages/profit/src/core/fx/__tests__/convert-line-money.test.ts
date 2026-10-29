import { Decimal } from 'decimal.js';
import { FxRateSource } from '@pazarsync/db/enums';
import { describe, expect, it } from 'vitest';

import { toCurrencyCode } from '../currency-code';
import { convertLineMoney } from '../convert-line-money';

const USD = toCurrencyCode('USD');

describe('convertLineMoney', () => {
  it('converts gross and VAT separately and keeps the original', () => {
    const original = { gross: new Decimal('10'), vat: new Decimal('1.67') };
    const out = convertLineMoney(original, USD, {
      rate: new Decimal('41.8'),
      rateDate: '2026-10-28',
      source: FxRateSource.TCMB,
    });
    expect(out.amount.gross.toFixed(2)).toBe('418.00');
    expect(out.amount.vat.toFixed(2)).toBe('69.81');
    expect(out.fx.currency).toBe('USD');
    expect(out.fx.original).toEqual(original);
  });
  it('carries a manual rate through with source MANUAL', () => {
    const out = convertLineMoney({ gross: new Decimal('10'), vat: new Decimal('0') }, USD, {
      rate: new Decimal('38'),
      rateDate: null,
      source: FxRateSource.MANUAL,
    });
    expect(out.amount.gross.toFixed(2)).toBe('380.00');
    expect(out.fx.source).toBe(FxRateSource.MANUAL);
  });
});
