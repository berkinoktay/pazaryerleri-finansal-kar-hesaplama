// The shared reading of a tariff workbook's price cell (`knownPrice`): a cell that read as
// no decimal, or a value that is zero at the stored scale, is an unknown price (null);
// any other value is kept as the file's own text.

import { describe, expect, it } from 'vitest';

import { knownPrice } from '@/workbooks/formats/trendyol/known-price';

describe('knownPrice', () => {
  it('is null for null', () => {
    expect(knownPrice(null)).toBeNull();
  });

  it('is null for 0, 0.00 and 0.004', () => {
    expect(knownPrice('0')).toBeNull();
    expect(knownPrice('0.00')).toBeNull();
    expect(knownPrice('0.004')).toBeNull();
  });

  it("keeps a readable price as the file's text", () => {
    expect(knownPrice('449.9')).toBe('449.9');
    expect(knownPrice('0.005')).toBe('0.005');
  });

  it('keeps a negative price', () => {
    expect(knownPrice('-12.5')).toBe('-12.5');
  });
});
