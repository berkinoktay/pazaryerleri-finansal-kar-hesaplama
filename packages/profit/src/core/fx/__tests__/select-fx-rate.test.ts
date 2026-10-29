import { Decimal } from 'decimal.js';
import { FxRateSource } from '@pazarsync/db/enums';
import { describe, expect, it } from 'vitest';

import { CURRENCY_TRY, toCurrencyCode, type CurrencyCode } from '../currency-code';
import { selectFxRate, type FxRateQuote } from '../select-fx-rate';

const USD = toCurrencyCode('USD');
const CNY = toCurrencyCode('CNY');
const q = (currency: CurrencyCode, rateDate: string, rate: string): FxRateQuote => ({
  currency,
  rateDate,
  rateToBase: new Decimal(rate),
});
const quotes = [
  q(USD, '2026-10-27', '41.5'),
  q(USD, '2026-10-28', '41.8'),
  q(USD, '2026-10-30', '41.9'),
  q(CNY, '2026-10-28', '5.8'),
];
const select = (from: CurrencyCode, to: CurrencyCode, eventDate: string, qs = quotes) =>
  selectFxRate({
    from,
    to,
    eventDate,
    base: CURRENCY_TRY,
    quotes: qs,
    quoteSource: FxRateSource.TCMB,
  });

describe('selectFxRate', () => {
  it('uses the quote of the event date', () => {
    const r = select(USD, CURRENCY_TRY, '2026-10-28');
    expect(r?.rate.toString()).toBe('41.8');
    expect(r?.rateDate).toBe('2026-10-28');
    expect(r?.source).toBe(FxRateSource.TCMB);
  });
  it('falls back to the last published rate on a holiday or weekend', () => {
    // Review focus 4
    expect(select(USD, CURRENCY_TRY, '2026-10-29')?.rateDate).toBe('2026-10-28');
    expect(select(USD, CURRENCY_TRY, '2026-11-01')?.rateDate).toBe('2026-10-30');
  });
  it('returns null before the first available quote', () => {
    // Review focus 4
    expect(select(USD, CURRENCY_TRY, '2026-10-26')).toBeNull();
  });
  it('same currency is native', () => {
    const r = select(CURRENCY_TRY, CURRENCY_TRY, '2026-10-28');
    expect(r?.rate.toString()).toBe('1');
    expect(r?.rateDate).toBeNull();
    expect(r?.source).toBe(FxRateSource.NATIVE);
  });
  it('inverts the quote when converting from the base', () => {
    expect(select(CURRENCY_TRY, USD, '2026-10-28')?.rate.toFixed(6)).toBe('0.023923');
  });
  it('crosses two non-base currencies through the base', () => {
    const r = select(CNY, USD, '2026-10-28');
    expect(r?.rate.toFixed(6)).toBe('0.138756');
    expect(r?.rateDate).toBe('2026-10-28');
  });
  it('takes the older date for a cross rate', () => {
    const r = select(CNY, USD, '2026-10-28', [
      q(CNY, '2026-10-27', '5.79'),
      q(USD, '2026-10-28', '41.8'),
    ]);
    expect(r?.rateDate).toBe('2026-10-27');
    expect(r?.rate.toFixed(6)).toBe('0.138517');
  });
  it('rejects a malformed event date', () => {
    expect(() => select(USD, CURRENCY_TRY, '28.10.2026')).toThrow(RangeError);
  });
});
