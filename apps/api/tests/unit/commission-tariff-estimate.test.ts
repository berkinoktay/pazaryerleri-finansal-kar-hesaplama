// Unit tests for `bandForPrice` — the pure price → band resolution behind the
// custom-price what-if. Trendyol bands touch at their boundaries (band2.upper =
// band1.lower), so the tie-break rule (first containing band wins → higher band)
// must be exact.

import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { bandForPrice } from '@/services/commission-tariff-compute.service';
import type { StoredBand } from '@/services/commission-tariff.types';

// band1 [450, ∞) · band2 [400, 450] · band3 [350, 400] · band4 (-∞, 350]
const BANDS: StoredBand[] = [
  { key: 'band1', lowerLimit: '450', upperLimit: null, commissionPct: '19' },
  { key: 'band2', lowerLimit: '400', upperLimit: '450', commissionPct: '15' },
  { key: 'band3', lowerLimit: '350', upperLimit: '400', commissionPct: '12' },
  { key: 'band4', lowerLimit: null, upperLimit: '350', commissionPct: '10' },
];

function resolve(price: string): string | null {
  return bandForPrice(BANDS, new Decimal(price))?.key ?? null;
}

describe('bandForPrice', () => {
  it('routes a high price into the open-topped band1', () => {
    expect(resolve('1000')).toBe('band1');
    expect(resolve('450')).toBe('band1'); // shared boundary → higher band
  });

  it('routes a strictly-interior price into its band', () => {
    expect(resolve('420')).toBe('band2');
    expect(resolve('375')).toBe('band3');
  });

  it('routes shared boundaries to the higher band (first match wins)', () => {
    expect(resolve('400')).toBe('band2'); // band2.lower == band3.upper
    expect(resolve('350')).toBe('band3'); // band3.lower == band4.upper
  });

  it('routes a low price into the open-bottomed band4', () => {
    expect(resolve('100')).toBe('band4');
    expect(resolve('0')).toBe('band4');
  });

  it('returns null when there are no bands', () => {
    expect(bandForPrice([], new Decimal('100'))).toBeNull();
  });
});
