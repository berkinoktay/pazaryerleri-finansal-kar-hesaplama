import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { vatFromGross } from '../vat';

describe('vatFromGross', () => {
  it.each([
    ['491.28', '10', '44.66'],
    ['380.47', '10', '34.59'],
    ['233', '10', '21.18'],
    ['165', '10', '15.00'],
    ['93.34', '20', '15.56'],
    ['72.29', '20', '12.05'],
    ['98.34', '20', '16.39'],
    ['13.19', '20', '2.20'],
    ['100', '0', '0.00'],
  ])('vatFromGross(%s, %s%%) = %s', (gross, rate, expected) => {
    expect(vatFromGross(new Decimal(gross), new Decimal(rate)).toFixed(2)).toBe(expected);
  });
  it('rejects a negative rate', () => {
    expect(() => vatFromGross(new Decimal('10'), new Decimal('-1'))).toThrow(RangeError);
  });
});
