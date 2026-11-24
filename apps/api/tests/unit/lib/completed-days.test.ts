import { describe, expect, it } from 'vitest';

import { completedDaysScope, completedOrderDateFilter } from '@/lib/completed-days';

// 15:00 Istanbul on 23 Nov 2026: the open business day is the 23rd, the last
// completed one the 22nd. Fixed instants are fine here because `now` is passed
// explicitly.
const now = new Date('2026-11-23T12:00:00.000Z');
const scope = completedDaysScope(now);

describe('completedDaysScope', () => {
  it('scope names the open day and the last completed day', () => {
    expect(scope).toMatchObject({
      openBusinessDate: '2026-11-23',
      lastCompletedBusinessDate: '2026-11-22',
    });
    expect(scope.cutoff.toISOString()).toBe('2026-11-22T21:00:00.000Z');
    expect(scope.openDayAnchor.toISOString()).toBe('2026-11-23T00:00:00.000Z');
  });

  it('scope at 23:59:59.999 Istanbul still has yesterday as last completed; at 00:00:00.000 it moves', () => {
    const lastInstant = completedDaysScope(new Date('2026-11-23T20:59:59.999Z'));
    expect(lastInstant).toMatchObject({
      openBusinessDate: '2026-11-23',
      lastCompletedBusinessDate: '2026-11-22',
    });
    expect(lastInstant.cutoff.toISOString()).toBe('2026-11-22T21:00:00.000Z');

    const midnight = completedDaysScope(new Date('2026-11-23T21:00:00.000Z'));
    expect(midnight).toMatchObject({
      openBusinessDate: '2026-11-24',
      lastCompletedBusinessDate: '2026-11-23',
    });
    expect(midnight.cutoff.toISOString()).toBe('2026-11-23T21:00:00.000Z');
    expect(midnight.openDayAnchor.toISOString()).toBe('2026-11-24T00:00:00.000Z');
  });
});

describe('completedOrderDateFilter', () => {
  it('no range -> only lt cutoff', () => {
    expect(completedOrderDateFilter({}, scope)).toEqual({ lt: scope.cutoff });
  });

  it('to = today is clamped to the cutoff', () => {
    const filter = completedOrderDateFilter({ to: '2026-11-23' }, scope);
    expect(filter.lt.toISOString()).toBe(scope.cutoff.toISOString());
    expect(filter).not.toHaveProperty('gte');
  });

  it('to = a past day keeps the earlier bound', () => {
    const filter = completedOrderDateFilter({ to: '2026-11-20' }, scope);
    expect(filter.lt.toISOString()).toBe('2026-11-20T21:00:00.000Z');
  });

  it('from is kept', () => {
    const filter = completedOrderDateFilter({ from: '2026-11-10' }, scope);
    expect(filter.gte?.toISOString()).toBe('2026-11-09T21:00:00.000Z');
    // Positive control: the upper bound is still the cutoff.
    expect(filter.lt.toISOString()).toBe(scope.cutoff.toISOString());
  });

  it('from = today gives an empty window', () => {
    const filter = completedOrderDateFilter({ from: '2026-11-23' }, scope);
    expect(filter.gte).toBeDefined();
    if (filter.gte === undefined) return;
    expect(filter.gte.getTime()).toBeGreaterThanOrEqual(filter.lt.getTime());
  });
});
