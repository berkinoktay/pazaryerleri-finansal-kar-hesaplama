import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { isPositiveAtCents } from '@/features/campaigns/lib/positive-at-cents';

describe('isPositiveAtCents', () => {
  it('is true for 0.01', () => {
    expect(isPositiveAtCents(new Decimal('0.01'))).toBe(true);
  });

  it('is false for 0, 0.004 and a negative', () => {
    expect(isPositiveAtCents(new Decimal('0'))).toBe(false);
    // Above 0, but sent as 0.00 once rounded to two decimals.
    expect(isPositiveAtCents(new Decimal('0.004'))).toBe(false);
    expect(isPositiveAtCents(new Decimal('-5'))).toBe(false);
  });
});
