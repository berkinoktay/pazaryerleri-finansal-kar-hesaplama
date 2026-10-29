import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { grossToVat, roundMoney } from '../money';

const D = (v: string) => new Decimal(v);

describe('grossToVat', () => {
  it('extracts embedded VAT from a gross amount (20%)', () => {
    expect(grossToVat(D('120'), D('20')).toString()).toBe('20');
  });

  it('non-terminating ratio keeps full precision', () => {
    // 100 × 20 / 120 = 16.6666666666… — verify the precision tail survives
    expect(grossToVat(D('100'), D('20')).toFixed(10)).toBe('16.6666666667');
  });

  it('zero rate yields zero VAT', () => {
    expect(grossToVat(D('100'), D('0')).toString()).toBe('0');
  });
});

describe('roundMoney', () => {
  it('rounds half up to two decimals', () => {
    expect(roundMoney(new Decimal('44.661818')).toFixed(2)).toBe('44.66');
    expect(roundMoney(new Decimal('2.198333')).toFixed(2)).toBe('2.20');
    expect(roundMoney(new Decimal('4.465')).toFixed(2)).toBe('4.47');
    expect(roundMoney(new Decimal('-3.125')).toFixed(2)).toBe('-3.13');
  });
});
