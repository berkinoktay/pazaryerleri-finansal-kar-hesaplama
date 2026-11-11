import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  parseStoredTariffBands,
  storedTariffBandForPrice,
  type StoredTariffBand,
} from '../stored-tariff-bands';

describe('parseStoredTariffBands', () => {
  it('returns an empty list for a non-array value', () => {
    expect(parseStoredTariffBands(null)).toEqual([]);
    expect(parseStoredTariffBands('nope')).toEqual([]);
    expect(parseStoredTariffBands(42)).toEqual([]);
    expect(parseStoredTariffBands({ key: 'band1' })).toEqual([]);
  });

  it('drops malformed entries', () => {
    const value = [
      'not-an-object',
      null,
      ['nested', 'array'],
      { lowerLimit: '10', upperLimit: '20' }, // missing key + commissionPct
      { key: 'band1' }, // missing commissionPct
      { key: 42, commissionPct: '19' }, // non-string key
      { key: 'band2', commissionPct: 19 }, // non-string commissionPct
    ];
    expect(parseStoredTariffBands(value)).toEqual([]);
  });

  it('reads absent limits back as null', () => {
    const value = [
      { key: 'band1', commissionPct: '19' }, // no limits at all
      { key: 'band2', lowerLimit: '200', commissionPct: '17' }, // no upper
    ];
    expect(parseStoredTariffBands(value)).toEqual([
      { key: 'band1', lowerLimit: null, upperLimit: null, commissionPct: '19' },
      { key: 'band2', lowerLimit: '200', upperLimit: null, commissionPct: '17' },
    ]);
  });

  it('keeps a valid band key and its string fields', () => {
    const value = [
      { key: 'band3', lowerLimit: '100.50', upperLimit: '199.99', commissionPct: '13.1' },
    ];
    expect(parseStoredTariffBands(value)).toEqual([
      { key: 'band3', lowerLimit: '100.50', upperLimit: '199.99', commissionPct: '13.1' },
    ]);
  });
});

// Trendyol bands touch at their boundaries (band2.upper = band1.lower), so the
// tie-break rule (first containing band wins -> higher band) must be exact.
// band1 [450, inf) . band2 [400, 450] . band3 [350, 400] . band4 (-inf, 350]
const BANDS: StoredTariffBand[] = [
  { key: 'band1', lowerLimit: '450', upperLimit: null, commissionPct: '19' },
  { key: 'band2', lowerLimit: '400', upperLimit: '450', commissionPct: '15' },
  { key: 'band3', lowerLimit: '350', upperLimit: '400', commissionPct: '12' },
  { key: 'band4', lowerLimit: null, upperLimit: '350', commissionPct: '10' },
];

function resolve(price: string): string | null {
  return storedTariffBandForPrice(BANDS, new Decimal(price))?.key ?? null;
}

describe('storedTariffBandForPrice', () => {
  it('routes a high price into the open-topped band1', () => {
    expect(resolve('1000')).toBe('band1');
    expect(resolve('450')).toBe('band1'); // shared boundary -> higher band
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
    expect(storedTariffBandForPrice([], new Decimal('100'))).toBeNull();
  });

  it('returns the stored band itself so its key survives', () => {
    // The hit maps back to the SAME stored band object, carrying its `key` and raw
    // string limits -- not the converted TrendyolCommissionBand the lookup ran on.
    const hit = storedTariffBandForPrice(BANDS, new Decimal('420'));
    expect(hit).toBe(BANDS[1]);
    expect(hit?.key).toBe('band2');
    expect(hit?.commissionPct).toBe('15');
  });
});
