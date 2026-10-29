import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { grossFromNet, vatFromGross } from '../vat';

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

describe('grossFromNet', () => {
  it.each([
    ['10.99', '20', '13.19'],
    ['6.99', '20', '8.39'],
    ['93.63', '20', '112.36'],
    ['34.16', '20', '40.99'],
    ['77.54', '20', '93.05'],
    ['81.95', '20', '98.34'],
    ['50.00', '20', '60.00'],
    ['0', '20', '0.00'],
    ['100', '0', '100.00'],
  ])('grossFromNet(%s, %s%%) = %s', (net, rate, expected) => {
    expect(grossFromNet(new Decimal(net), new Decimal(rate)).toFixed(2)).toBe(expected);
  });
  it('rejects a negative rate', () => {
    expect(() => grossFromNet(new Decimal('10'), new Decimal('-1'))).toThrow(RangeError);
  });
});
