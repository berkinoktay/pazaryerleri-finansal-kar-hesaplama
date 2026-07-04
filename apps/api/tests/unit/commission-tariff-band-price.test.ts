import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { bandPrice } from '@/services/commission-tariff-compute.service';
import type { StoredBand } from '@/services/commission-tariff.types';

/** Terse band builder — defaults both limits to null, override what the case needs. */
function band(partial: Partial<StoredBand> & Pick<StoredBand, 'key'>): StoredBand {
  return { lowerLimit: null, upperLimit: null, commissionPct: '19', ...partial };
}

const CURRENT = new Decimal('500');

describe('bandPrice', () => {
  it('uses the UPPER limit for the bounded bands (2-4, "X ve altı")', () => {
    expect(
      bandPrice(band({ key: 'band2', lowerLimit: '400', upperLimit: '450' }), CURRENT).toFixed(2),
    ).toBe('450.00');
    expect(
      bandPrice(band({ key: 'band3', lowerLimit: '350', upperLimit: '400' }), CURRENT).toFixed(2),
    ).toBe('400.00');
    expect(bandPrice(band({ key: 'band4', upperLimit: '350' }), CURRENT).toFixed(2)).toBe('350.00');
  });

  it('uses the LOWER limit for the open-topped band 1 ("X ve üzeri"), NOT the current price', () => {
    // The current price (500) already sits inside band1 [450, ∞), yet the representative
    // price is band1's floor (450) — the boundary the seller sees in that column, matching
    // Trendyol's own panel (which pins the update field to the floor regardless of current).
    expect(bandPrice(band({ key: 'band1', lowerLimit: '450' }), CURRENT).toFixed(2)).toBe('450.00');
  });

  it('falls back to the current price only for a band with neither limit', () => {
    expect(bandPrice(band({ key: 'band1' }), new Decimal('285')).toFixed(2)).toBe('285.00');
  });
});
