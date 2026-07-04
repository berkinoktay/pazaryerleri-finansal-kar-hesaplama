import { describe, expect, it } from 'vitest';

import { parseStarTiers } from '@/services/advantage-tariff.types';

describe('parseStarTiers', () => {
  it('parses a well-formed 3-tier array, reading an absent lowerLimit as null', () => {
    const tiers = parseStarTiers([
      { key: 'tier1', upperLimit: '292.91', lowerLimit: '274.43' },
      { key: 'tier2', upperLimit: '274.42', lowerLimit: '223.79' },
      { key: 'tier3', upperLimit: '223.78' }, // no lowerLimit (Süper Avantaj: "ve altı")
    ]);
    expect(tiers).toEqual([
      { key: 'tier1', upperLimit: '292.91', lowerLimit: '274.43' },
      { key: 'tier2', upperLimit: '274.42', lowerLimit: '223.79' },
      { key: 'tier3', upperLimit: '223.78', lowerLimit: null },
    ]);
  });

  it('drops entries with an unknown key or a non-string upperLimit', () => {
    const tiers = parseStarTiers([
      { key: 'tier1', upperLimit: '100.00' },
      { key: 'tier9', upperLimit: '50.00' }, // unknown key → dropped
      { key: 'tier2', upperLimit: 50 }, // numeric upperLimit → dropped
    ]);
    expect(tiers).toEqual([{ key: 'tier1', upperLimit: '100.00', lowerLimit: null }]);
  });

  it('returns an empty array for a non-array value', () => {
    expect(parseStarTiers(null)).toEqual([]);
    expect(parseStarTiers({ key: 'tier1' })).toEqual([]);
    expect(parseStarTiers('nope')).toEqual([]);
  });
});
