import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  deriveCalculable,
  feeToProfitInputFee,
} from '../../../src/services/product-pricing-assembly';

const D = (v: string) => new Decimal(v);

describe('feeToProfitInputFee', () => {
  it('converts a NET shipping amount to a GROSS DEBIT fee with embedded VAT', () => {
    const fee = feeToProfitInputFee(D('40'), D('20'), 'SHIPPING');
    expect(fee.type).toBe('SHIPPING');
    expect(fee.direction).toBe('DEBIT');
    expect(fee.gross.toFixed(2)).toBe('48.00'); // 40 × 120/100
    expect(fee.vat.toFixed(2)).toBe('8.00'); // grossToVat(48,20)
  });
});

describe('deriveCalculable', () => {
  it('true only when cost, shipping and commission are all OK', () => {
    expect(deriveCalculable('OK', 'OK', 'OK')).toBe(true);
  });
  it('false when any input is not OK', () => {
    expect(deriveCalculable('NO_PROFILES', 'OK', 'OK')).toBe(false);
    expect(deriveCalculable('OK', 'NO_CARRIER', 'OK')).toBe(false);
    expect(deriveCalculable('OK', 'OK', 'NO_RULE')).toBe(false);
  });
});
