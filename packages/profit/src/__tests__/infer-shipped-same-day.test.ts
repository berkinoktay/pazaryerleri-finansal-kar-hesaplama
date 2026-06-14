import { describe, expect, it } from 'vitest';

import { inferShippedSameDay } from '../infer-shipped-same-day';

// APP_TIME_ZONE = Europe/Istanbul (UTC+3, no DST). getBusinessDate buckets each
// true-instant into its Istanbul calendar day. orderDate is a true instant
// (already normalised from Trendyol's GMT+3 stamp); actualShipDate is true-UTC.

describe('inferShippedSameDay', () => {
  it('returns null when not yet shipped (actualShipDate null)', () => {
    expect(
      inferShippedSameDay({
        orderDate: new Date('2026-06-12T07:28:00.000Z'),
        actualShipDate: null,
      }),
    ).toBeNull();
  });

  it('returns true when shipped on the same Istanbul day (real prod 11315572876)', () => {
    // order 10:28 IST, shipped 14:35 IST — both 2026-06-12 in Istanbul.
    expect(
      inferShippedSameDay({
        orderDate: new Date('2026-06-12T07:28:45.000Z'),
        actualShipDate: new Date('2026-06-12T11:35:54.000Z'),
      }),
    ).toBe(true);
  });

  it('returns false when shipped on a later Istanbul day (next-day ship)', () => {
    // order 06-12 10:28 IST, shipped 06-13 08:00 IST.
    expect(
      inferShippedSameDay({
        orderDate: new Date('2026-06-12T07:28:45.000Z'),
        actualShipDate: new Date('2026-06-13T05:00:00.000Z'),
      }),
    ).toBe(false);
  });

  it('compares Istanbul days, not UTC days (UTC differs, Istanbul same → true)', () => {
    // order true instant 2026-06-11T22:00Z = 2026-06-12 01:00 IST → IST day 06-12.
    // ship  true instant 2026-06-12T20:00Z = 2026-06-12 23:00 IST → IST day 06-12.
    // UTC days (11 vs 12) differ, but Istanbul days match → same-day.
    expect(
      inferShippedSameDay({
        orderDate: new Date('2026-06-11T22:00:00.000Z'),
        actualShipDate: new Date('2026-06-12T20:00:00.000Z'),
      }),
    ).toBe(true);
  });

  it('compares Istanbul days (UTC same, Istanbul differs → false)', () => {
    // order true instant 2026-06-12T20:00Z = 06-12 23:00 IST → IST day 06-12.
    // ship  true instant 2026-06-12T21:30Z = 06-13 00:30 IST → IST day 06-13.
    // UTC day same (12), Istanbul days differ → NOT same-day.
    expect(
      inferShippedSameDay({
        orderDate: new Date('2026-06-12T20:00:00.000Z'),
        actualShipDate: new Date('2026-06-12T21:30:00.000Z'),
      }),
    ).toBe(false);
  });
});
