import { describe, expect, it } from 'vitest';

import {
  clockSettledCutoff,
  getBusinessDateAnchor,
  getBusinessDayRange,
  isDaySettled,
  previousDayStart,
  SELLER_INPUT_SETTLE_CAP_MS,
  SELLER_INPUT_SETTLE_MS,
  SELLER_INPUT_TX_OPTIONS,
} from '../src/index';

const ONE_MS = 1;
const HOUR_MS = 60 * 60 * 1000;

// One clock read: T is the start of today's business day (the end of yesterday's),
// and every instant below derives from it, so no case can straddle midnight.
const T = getBusinessDayRange(new Date()).start;
const YESTERDAY_ORDER = new Date(T.getTime() - 6 * HOUR_MS);
const TODAY_ORDER = new Date(T.getTime() + 6 * HOUR_MS);

describe('seller-input settle constants', () => {
  it('the settle wait outlasts four writer transaction timeouts, and the cap outlasts the settle wait', () => {
    expect(SELLER_INPUT_SETTLE_MS).toBeGreaterThanOrEqual(4 * SELLER_INPUT_TX_OPTIONS.timeout);
    expect(SELLER_INPUT_SETTLE_CAP_MS).toBeGreaterThan(SELLER_INPUT_SETTLE_MS);
  });
});

describe('previousDayStart', () => {
  it('is the start of the business day that ends at the given day start', () => {
    const previous = previousDayStart(T);

    expect(previous).toEqual(getBusinessDayRange(new Date(T.getTime() - ONE_MS)).start);
    expect(getBusinessDayRange(previous).end).toEqual(T);
  });
});

describe('clockSettledCutoff', () => {
  it('stays on the previous day start until the settle wait has passed after the day end', () => {
    expect(clockSettledCutoff(new Date(T.getTime() + SELLER_INPUT_SETTLE_MS - ONE_MS))).toEqual(
      previousDayStart(T),
    );
    expect(clockSettledCutoff(new Date(T.getTime() + SELLER_INPUT_SETTLE_MS))).toEqual(T);
  });
});

describe('isDaySettled', () => {
  it("is true once the cutoff reaches the order's day end, false before", () => {
    expect(isDaySettled(YESTERDAY_ORDER, T)).toBe(true);
    // The last millisecond of yesterday is settled at T; the first of today is not.
    expect(isDaySettled(new Date(T.getTime() - ONE_MS), T)).toBe(true);
    expect(isDaySettled(T, T)).toBe(false);
    expect(isDaySettled(TODAY_ORDER, T)).toBe(false);
    expect(isDaySettled(YESTERDAY_ORDER, previousDayStart(T))).toBe(false);
  });

  it("a buffer's business-date anchor gives the same answer as `anchor < getBusinessDateAnchor(cutoff)`", () => {
    const cutoffAnchor = getBusinessDateAnchor(T);
    const yesterdayAnchor = getBusinessDateAnchor(YESTERDAY_ORDER);
    const todayAnchor = getBusinessDateAnchor(TODAY_ORDER);

    expect(isDaySettled(yesterdayAnchor, T)).toBe(true);
    expect(yesterdayAnchor.getTime() < cutoffAnchor.getTime()).toBe(true);
    expect(isDaySettled(todayAnchor, T)).toBe(false);
    expect(todayAnchor.getTime() < cutoffAnchor.getTime()).toBe(false);
  });
});
