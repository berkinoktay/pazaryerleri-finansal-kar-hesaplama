import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { percentOrNull } from '@/services/tariff-compute-commons';

describe('percentOrNull', () => {
  it('percentOrNull is null for null', () => {
    expect(percentOrNull(null)).toBeNull();
  });

  it('prints four decimals for a value', () => {
    expect(percentOrNull(new Decimal('12.5'))).toBe('12.5000');
    expect(percentOrNull(new Decimal('21.2345'))).toBe('21.2345');
  });

  it('keeps a 0 as 0.0000', () => {
    expect(percentOrNull(new Decimal(0))).toBe('0.0000');
  });
});
