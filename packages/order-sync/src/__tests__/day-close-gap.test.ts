import { describe, expect, it } from 'vitest';

import { Prisma } from '@pazarsync/db';
import { ProfitExclusionReason } from '@pazarsync/db/enums';

import {
  DAY_CLOSE_STAMPS_MISSING_DESI,
  dayCloseGap,
  dayCloseStampedGap,
  type DayCloseLine,
} from '../finalize-seller-inputs';
import { type PastDayGap, pastDayGapReason } from '../past-day-gap';

// The day-close gap of an order's items after their re-derive at the business-day end
// (same-day edit window, plan P1-17). Owner rule (Berkin 2026-11-23): an order's cost
// and desi are the values in force at the end of its Istanbul business day. Every item
// needs a cost; a resolved, non-digital item also needs a desi; the cost gap wins.

/** A costed, non-digital item with a desi: no gap. Each case overrides one field. */
function line(over: Partial<DayCloseLine> = {}): DayCloseLine {
  return {
    productVariantId: 'variant-1',
    costVersionIds: ['version-1'],
    unitDesi: new Prisma.Decimal('2'),
    isDigital: false,
    ...over,
  };
}

describe('dayCloseGap', () => {
  it('an item with an empty cost list is a cost gap', () => {
    expect(dayCloseGap([line(), line({ costVersionIds: [] })])).toBe('cost');
    // A null list (the column is nullable in the database) counts as empty.
    expect(dayCloseGap([line({ costVersionIds: null })])).toBe('cost');
  });

  it('an unmatched item is a cost gap', () => {
    expect(
      dayCloseGap([line({ productVariantId: null, costVersionIds: [], unitDesi: null })]),
    ).toBe('cost');
  });

  it('a costed non-digital item without desi is a desi gap', () => {
    expect(dayCloseGap([line(), line({ unitDesi: null })])).toBe('desi');
  });

  it('cost wins when both are missing', () => {
    // On one item, and on two different items in either order.
    expect(dayCloseGap([line({ costVersionIds: [], unitDesi: null })])).toBe('cost');
    expect(dayCloseGap([line({ unitDesi: null }), line({ costVersionIds: [] })])).toBe('cost');
    expect(dayCloseGap([line({ costVersionIds: [] }), line({ unitDesi: null })])).toBe('cost');
  });

  it('a digital item without desi is no gap', () => {
    expect(dayCloseGap([line({ isDigital: true, unitDesi: null })])).toBeNull();
    // Positive control: the same item when not digital is a desi gap.
    expect(dayCloseGap([line({ isDigital: false, unitDesi: null })])).toBe('desi');
  });

  it('a desi of 0 is no gap', () => {
    expect(dayCloseGap([line({ unitDesi: new Prisma.Decimal('0') })])).toBeNull();
    // Positive control: the same item with no desi at all is a desi gap.
    expect(dayCloseGap([line({ unitDesi: null })])).toBe('desi');
  });

  it('no items -> no gap', () => {
    expect(dayCloseGap([])).toBeNull();
    // Positive control: one uncosted item is a cost gap.
    expect(dayCloseGap([line({ costVersionIds: [] })])).toBe('cost');
  });
});

describe('dayCloseStampedGap (the B2 switch, ON by amendment C1)', () => {
  it('a desi gap is stamped by default and dropped only when the switch is off', () => {
    expect(DAY_CLOSE_STAMPS_MISSING_DESI).toBe(true);
    expect(dayCloseStampedGap('desi')).toBe('desi');
    expect(dayCloseStampedGap('desi', { stampMissingDesi: true })).toBe('desi');
    expect(dayCloseStampedGap('desi', { stampMissingDesi: false })).toBeNull();
  });

  it('a cost gap and no gap pass whatever the switch', () => {
    expect(dayCloseStampedGap('cost')).toBe('cost');
    expect(dayCloseStampedGap('cost', { stampMissingDesi: true })).toBe('cost');
    expect(dayCloseStampedGap('cost', { stampMissingDesi: false })).toBe('cost');
    expect(dayCloseStampedGap(null)).toBeNull();
    expect(dayCloseStampedGap(null, { stampMissingDesi: false })).toBeNull();
  });
});

/** The permanent reason table: gap, arrival, reason. */
const GAP_REASON_CASES: readonly (readonly [
  PastDayGap,
  'graduated' | 'direct',
  ProfitExclusionReason,
])[] = [
  ['cost', 'graduated', ProfitExclusionReason.COST_DEADLINE_MISSED],
  ['cost', 'direct', ProfitExclusionReason.LATE_UNCOSTED_ARRIVAL],
  ['desi', 'graduated', ProfitExclusionReason.DESI_DEADLINE_MISSED],
  ['desi', 'direct', ProfitExclusionReason.LATE_DESILESS_ARRIVAL],
];

describe('pastDayGapReason', () => {
  it.each(GAP_REASON_CASES)(
    'a %s gap of an order that arrived %s is %s',
    (gap, arrival, reason) => {
      expect(pastDayGapReason(gap, arrival)).toBe(reason);
    },
  );

  it('the four cases give four different reasons', () => {
    const reasons = new Set([
      pastDayGapReason('cost', 'graduated'),
      pastDayGapReason('cost', 'direct'),
      pastDayGapReason('desi', 'graduated'),
      pastDayGapReason('desi', 'direct'),
    ]);
    expect(reasons.size).toBe(4);
  });
});
