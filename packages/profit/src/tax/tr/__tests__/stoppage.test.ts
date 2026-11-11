import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { netSaleStoppageBase, stoppageAmount } from '../stoppage';

describe('stoppage', () => {
  it('uses the VAT-exclusive sale as the base', () => {
    expect(
      netSaleStoppageBase({ gross: new Decimal('491.28'), vat: new Decimal('44.66') }).toFixed(2),
    ).toBe('446.62');
  });
  it.each([
    ['446.62', '1', '4.47'],
    ['345.88', '1', '3.46'],
    ['446.62', '0', '0.00'],
  ])('stoppageAmount(%s, %s%%) = %s', (base, rate, expected) => {
    expect(stoppageAmount(new Decimal(base), new Decimal(rate)).toFixed(2)).toBe(expected);
  });
  it('rejects a negative rate', () => {
    expect(() => stoppageAmount(new Decimal('10'), new Decimal('-1'))).toThrow(RangeError);
  });
});
