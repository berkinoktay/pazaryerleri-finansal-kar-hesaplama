import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { bandPrice, type StoredTariffBand } from '../stored-tariff-bands';

/** Terse band builder — defaults both limits to null, override what the case needs. */
function band(
  partial: Partial<StoredTariffBand> & Pick<StoredTariffBand, 'key'>,
): StoredTariffBand {
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

  it('is null for a band with neither limit when the current price is unknown', () => {
    expect(bandPrice(band({ key: 'band1' }), null)).toBeNull();
  });

  it('skips a 0 upper limit and prices the band at its lower limit', () => {
    expect(
      bandPrice(band({ key: 'band2', lowerLimit: '400', upperLimit: '0.00' }), CURRENT).toFixed(2),
    ).toBe('400.00');
  });

  it('skips 0 limits and falls back to the current price', () => {
    expect(
      bandPrice(band({ key: 'band1', lowerLimit: '0', upperLimit: '0.00' }), CURRENT).toFixed(2),
    ).toBe('500.00');
  });

  it('has no price when its limits are 0 and the current price is unknown', () => {
    expect(bandPrice(band({ key: 'band4', lowerLimit: '0.00', upperLimit: '0' }), null)).toBeNull();
  });

  it('keeps a negative limit, so the upload write check can refuse it', () => {
    expect(bandPrice(band({ key: 'band2', upperLimit: '-5.00' }), CURRENT).toFixed(2)).toBe(
      '-5.00',
    );
  });

  it('keeps a 0 lower limit out of the way of a real upper limit', () => {
    expect(
      bandPrice(band({ key: 'band4', lowerLimit: '0.00', upperLimit: '350' }), CURRENT).toFixed(2),
    ).toBe('350.00');
  });

  it('ignores an unknown current price for a band with a limit', () => {
    // Upper-limit band: the upper limit is the price, the unknown current price is unused.
    expect(
      bandPrice(band({ key: 'band2', lowerLimit: '400', upperLimit: '450' }), null)?.toString(),
    ).toBe('450');
    // Lower-only band (open-topped band 1): the lower limit is the price.
    expect(bandPrice(band({ key: 'band1', lowerLimit: '450' }), null)?.toString()).toBe('450');
  });
});
