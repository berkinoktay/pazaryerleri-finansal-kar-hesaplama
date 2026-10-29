import { describe, expect, it } from 'vitest';

import { parseStoredTariffBands } from '../stored-tariff-bands';

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
