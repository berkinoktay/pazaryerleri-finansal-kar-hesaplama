import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { grossToVat } from '../money';

const D = (v: string) => new Decimal(v);

describe('grossToVat', () => {
  it('extracts embedded VAT from a gross amount (20%)', () => {
    expect(grossToVat(D('120'), D('20')).toString()).toBe('20');
  });

  it('non-terminating ratio keeps full precision', () => {
    // 100 × 20 / 120 = 16.666…
    expect(grossToVat(D('100'), D('20')).toFixed(4)).toBe('16.6667');
  });

  it('zero rate yields zero VAT', () => {
    expect(grossToVat(D('100'), D('0')).toString()).toBe('0');
  });
});
