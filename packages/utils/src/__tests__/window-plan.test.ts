import { describe, expect, it } from 'vitest';

import {
  planWindowFiles,
  TARIFF_WEEK_DAYS,
  type WindowFilePlan,
  type WindowPeriodInput,
} from '../window-plan';
import { WORKBOOK_PAGES } from '../workbook-pages';

// The window plan decides which picked key goes into which file: one file per
// sub-period for period-specific values, plus one whole-week file for keys picked
// with the identical string in EVERY sub-period. The cases below are the api's
// `commission-tariff-export-plan.test.ts` cases, ported from labels/suffixes to the
// numeric `dayCount` this function returns.

function period(dayCount: number | null, picks: Record<string, string>): WindowPeriodInput {
  return { dayCount, picks: new Map(Object.entries(picks)) };
}

interface PlanSummary {
  readonly dayCount: number;
  readonly periodIndices: readonly number[];
  readonly picks: ReadonlyArray<readonly [string, string]>;
}

// Entries as an array, so the assertions also pin file order and key order.
function summarize(plans: readonly WindowFilePlan[]): PlanSummary[] {
  return plans.map((plan) => ({
    dayCount: plan.dayCount,
    periodIndices: plan.periodIndices,
    picks: [...plan.picks],
  }));
}

describe('planWindowFiles', () => {
  it('returns nothing when no key is picked', () => {
    expect(planWindowFiles([period(3, {}), period(4, {})])).toEqual([]);
  });

  it('returns nothing for zero periods', () => {
    expect(planWindowFiles([])).toEqual([]);
  });

  it('returns nothing for a single period with no picks', () => {
    expect(planWindowFiles([period(7, {})])).toEqual([]);
  });

  it('a single full-week period yields one file tagged with its own day count', () => {
    expect(summarize(planWindowFiles([period(7, { A: '100.00', B: '250.00' })]))).toEqual([
      {
        dayCount: 7,
        periodIndices: [0],
        picks: [
          ['A', '100.00'],
          ['B', '250.00'],
        ],
      },
    ]);
  });

  it('a key picked at the same value in every period collapses into one week file', () => {
    expect(
      summarize(planWindowFiles([period(3, { A: '150.00' }), period(4, { A: '150.00' })])),
    ).toEqual([{ dayCount: 7, periodIndices: [0, 1], picks: [['A', '150.00']] }]);
  });

  it('a key picked at different values splits into both period files and no week file', () => {
    expect(
      summarize(planWindowFiles([period(3, { A: '150.00' }), period(4, { A: '190.00' })])),
    ).toEqual([
      { dayCount: 3, periodIndices: [0], picks: [['A', '150.00']] },
      { dayCount: 4, periodIndices: [1], picks: [['A', '190.00']] },
    ]);
  });

  it('a key picked only in the first period yields just that period file', () => {
    expect(summarize(planWindowFiles([period(3, { A: '150.00' }), period(4, {})]))).toEqual([
      { dayCount: 3, periodIndices: [0], picks: [['A', '150.00']] },
    ]);
  });

  it('a key picked only in the second period yields just that period file', () => {
    expect(summarize(planWindowFiles([period(3, {}), period(4, { A: '190.00' })]))).toEqual([
      { dayCount: 4, periodIndices: [1], picks: [['A', '190.00']] },
    ]);
  });

  it('buckets a mix of whole-week, split and single-window keys, period files first', () => {
    const plans = planWindowFiles([
      period(3, { SAME: '100.00', DIFF: '150.00', ONLY3: '120.00' }),
      period(4, { SAME: '100.00', DIFF: '190.00' }),
    ]);
    // SAME -> week file only; DIFF -> both period files; ONLY3 -> the 3-day file only.
    expect(summarize(plans)).toEqual([
      {
        dayCount: 3,
        periodIndices: [0],
        picks: [
          ['DIFF', '150.00'],
          ['ONLY3', '120.00'],
        ],
      },
      { dayCount: 4, periodIndices: [1], picks: [['DIFF', '190.00']] },
      { dayCount: 7, periodIndices: [0, 1], picks: [['SAME', '100.00']] },
    ]);
  });

  it('orders keys by period 0 first, then the new keys of later periods', () => {
    const plans = planWindowFiles([
      period(3, { B: '1.00', A: '1.00' }),
      period(4, { C: '2.00', A: '1.00', B: '1.00' }),
    ]);
    expect(summarize(plans)).toEqual([
      { dayCount: 4, periodIndices: [1], picks: [['C', '2.00']] },
      {
        dayCount: 7,
        periodIndices: [0, 1],
        picks: [
          ['B', '1.00'],
          ['A', '1.00'],
        ],
      },
    ]);
  });

  it('keeps a key out of the week file unless it is picked in every period', () => {
    const plans = planWindowFiles([
      period(2, { A: '1.00' }),
      period(2, { A: '1.00' }),
      period(3, {}),
    ]);
    expect(summarize(plans)).toEqual([
      { dayCount: 2, periodIndices: [0], picks: [['A', '1.00']] },
      { dayCount: 2, periodIndices: [1], picks: [['A', '1.00']] },
    ]);
  });

  it('falls back to the tariff week when the day counts sum to zero', () => {
    expect(TARIFF_WEEK_DAYS).toBe(7);
    expect(
      summarize(planWindowFiles([period(null, { A: '1.00' }), period(null, { A: '1.00' })])),
    ).toEqual([{ dayCount: TARIFF_WEEK_DAYS, periodIndices: [0, 1], picks: [['A', '1.00']] }]);
    expect(summarize(planWindowFiles([period(null, { A: '1.00' })]))).toEqual([
      { dayCount: TARIFF_WEEK_DAYS, periodIndices: [0], picks: [['A', '1.00']] },
    ]);
  });

  it('tags a null-day period with the week length, even when that repeats a tag', () => {
    // Pinned as today's output, not as a desired one: the null period counts as 0 in
    // the week sum (0 + 4 = 4) and then takes the week length as its own tag, so two
    // files share the "4" tag (and the export's file suffix). Unreachable today
    // because the layout regex requires the "(N Gun)" count; the bundle's filename
    // collision is handled in PR 3.
    expect(
      summarize(planWindowFiles([period(null, { A: '1.00' }), period(4, { A: '2.00' })])),
    ).toEqual([
      { dayCount: 4, periodIndices: [0], picks: [['A', '1.00']] },
      { dayCount: 4, periodIndices: [1], picks: [['A', '2.00']] },
    ]);
  });
});

describe('WORKBOOK_PAGES', () => {
  it('maps every key to an identical value', () => {
    for (const [key, value] of Object.entries(WORKBOOK_PAGES)) {
      expect(value).toBe(key);
    }
    expect(Object.keys(WORKBOOK_PAGES)).toEqual([
      'COMMISSION_TARIFF',
      'PLUS_COMMISSION_TARIFF',
      'ADVANTAGE_TARIFF',
      'FLASH_PRODUCT_LIST',
      'DISCOUNT_LIST',
      'MARKETPLACE_CAMPAIGN_LIST',
    ]);
  });
});
