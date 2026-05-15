import { describe, expect, it } from 'vitest';

import {
  SEGMENT_LABEL_ORDER,
  SEGMENT_LABELS,
  getSegmentLabel,
  orderedSegmentEntries,
} from '@/features/commission-rates/lib/segment-labels';

describe('SEGMENT_LABELS', () => {
  it('maps the four Trendyol segment keys to their Seviye labels', () => {
    expect(SEGMENT_LABELS).toEqual({
      ka1: 'Seviye 5',
      ka2: 'Seviye 4',
      na1: 'Seviye 3',
      microSegment: 'Özelleşmiş Grup',
    });
  });
});

describe('SEGMENT_LABEL_ORDER', () => {
  it('lists keys in descending Seviye (5 → 3) then Özelleşmiş Grup', () => {
    expect(SEGMENT_LABEL_ORDER).toEqual(['ka1', 'ka2', 'na1', 'microSegment']);
  });
});

describe('getSegmentLabel', () => {
  it('returns the mapped label for known keys', () => {
    expect(getSegmentLabel('ka1')).toBe('Seviye 5');
    expect(getSegmentLabel('microSegment')).toBe('Özelleşmiş Grup');
  });

  it('returns the raw key for unknown segment names', () => {
    expect(getSegmentLabel('unknownTier')).toBe('unknownTier');
  });
});

describe('orderedSegmentEntries', () => {
  it('returns mapped entries in SEGMENT_LABEL_ORDER, skipping absent keys', () => {
    expect(orderedSegmentEntries({ ka1: '4.00', na1: '3.50' })).toEqual([
      { key: 'ka1', label: 'Seviye 5', value: '4.00' },
      { key: 'na1', label: 'Seviye 3', value: '3.50' },
    ]);
  });

  it('appends unknown keys after the known order (preserves input order among unknowns)', () => {
    expect(orderedSegmentEntries({ unknownB: '2.00', ka2: '5.00', unknownA: '1.00' })).toEqual([
      { key: 'ka2', label: 'Seviye 4', value: '5.00' },
      { key: 'unknownB', label: 'unknownB', value: '2.00' },
      { key: 'unknownA', label: 'unknownA', value: '1.00' },
    ]);
  });

  it('returns [] for an empty map', () => {
    expect(orderedSegmentEntries({})).toEqual([]);
  });
});
