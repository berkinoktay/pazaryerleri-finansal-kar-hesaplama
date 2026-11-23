import { describe, expect, it } from 'vitest';

import { getBusinessDate, getBusinessDayRange } from '@pazarsync/utils';

import { businessDateRangeFilter } from '@/lib/business-date-range';

const DAY_MS = 24 * 60 * 60 * 1000;

// An instant three days back, its business date, and that business day's
// instant window. The validated `from`/`to` query params are `YYYY-MM-DD`
// business dates, which is what the filter receives.
const anchor = new Date(Date.now() - 3 * DAY_MS);
const businessDate = getBusinessDate(anchor);
const { start, end } = getBusinessDayRange(anchor);

describe('businessDateRangeFilter', () => {
  it('selects the whole business day when from and to name the same date', () => {
    expect(businessDateRangeFilter({ from: businessDate, to: businessDate })).toStrictEqual({
      gte: start,
      lt: end,
    });
  });

  it('has only a lower bound when only from is set', () => {
    const filter = businessDateRangeFilter({ from: businessDate });

    expect(filter).toStrictEqual({ gte: start });
    expect(filter).not.toHaveProperty('lt');
  });

  it('has only an upper bound, the end of that business day, when only to is set', () => {
    const filter = businessDateRangeFilter({ to: businessDate });

    expect(filter).toStrictEqual({ lt: end });
    expect(filter).not.toHaveProperty('gte');
  });

  it('is undefined when neither bound is set', () => {
    expect(businessDateRangeFilter({})).toBeUndefined();
    // Positive control: a set bound does produce a filter.
    expect(businessDateRangeFilter({ from: businessDate })).toBeDefined();
  });
});
