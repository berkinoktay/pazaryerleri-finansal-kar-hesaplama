import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { saleVatRatePct } from '../sale-vat';

describe('saleVatRatePct', () => {
  it.each([
    ['10', false, '10'],
    ['10', true, '0'],
    ['20', false, '20'],
  ])('saleVatRatePct(%s, export=%s) = %s', (rate, isExportSale, expected) => {
    expect(saleVatRatePct(new Decimal(rate), isExportSale).toString()).toBe(expected);
  });
});
