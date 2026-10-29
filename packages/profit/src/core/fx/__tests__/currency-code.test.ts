import { describe, expect, it } from 'vitest';

import {
  CURRENCY_TRY,
  InvalidCurrencyCodeError,
  isCurrencyCode,
  toCurrencyCode,
} from '../currency-code';

describe('currency code', () => {
  it('accepts ISO 4217 shaped codes', () => {
    for (const code of ['TRY', 'USD', 'EUR', 'CNY', 'GBP']) expect(isCurrencyCode(code)).toBe(true);
  });
  it('rejects malformed codes', () => {
    for (const code of ['usd', 'US', 'USDT', '', '12A']) expect(isCurrencyCode(code)).toBe(false);
  });
  it('toCurrencyCode throws on an invalid code', () => {
    expect(() => toCurrencyCode('eur')).toThrow(InvalidCurrencyCodeError);
  });
  it('CURRENCY_TRY is TRY', () => {
    expect(CURRENCY_TRY).toBe('TRY');
  });
});
