import { describe, expect, it } from 'vitest';

import {
  decideCoalesce,
  dedupeEvents,
  MAX_FETCH_PER_WINDOW,
  MIN_DING_INTERVAL_MS,
  planToast,
  selectSurvivors,
  shouldPlaySound,
  type NotificationSummaryLike,
} from '@/features/live-performance/lib/new-order-notification-core';

function summary(over: Partial<NotificationSummaryLike> = {}): NotificationSummaryLike {
  return {
    source: 'orders',
    orderId: 'o1',
    bufferId: null,
    platformOrderNumber: 'N1',
    revenue: '10.00',
    profit: '3.00',
    costStatus: 'costed',
    isToday: true,
    ...over,
  };
}

describe('dedupeEvents', () => {
  it('drops duplicate ids, preserves first-seen order', () => {
    expect(
      dedupeEvents([
        { table: 'orders', id: 'a' },
        { table: 'buffer', id: 'a' },
        { table: 'orders', id: 'b' },
      ]),
    ).toEqual([
      { table: 'orders', id: 'a' },
      { table: 'orders', id: 'b' },
    ]);
  });
});

describe('decideCoalesce', () => {
  it('fetch mode at or below cap', () => {
    const events = Array.from({ length: MAX_FETCH_PER_WINDOW }, (_, i) => ({
      table: 'orders' as const,
      id: `o${i}`,
    }));
    const d = decideCoalesce(events);
    expect(d.mode).toBe('fetch');
    expect(d.toFetch).toHaveLength(MAX_FETCH_PER_WINDOW);
    expect(d.total).toBe(MAX_FETCH_PER_WINDOW);
  });

  it('burst mode above cap (no per-event fetch)', () => {
    const events = Array.from({ length: MAX_FETCH_PER_WINDOW + 1 }, (_, i) => ({
      table: 'orders' as const,
      id: `o${i}`,
    }));
    const d = decideCoalesce(events);
    expect(d.mode).toBe('burst');
    expect(d.toFetch).toEqual([]);
    expect(d.total).toBe(MAX_FETCH_PER_WINDOW + 1);
  });

  it('dedupes before measuring against the cap', () => {
    const dup = { table: 'orders' as const, id: 'same' };
    const d = decideCoalesce([dup, dup, dup, dup, dup, dup]);
    expect(d.mode).toBe('fetch');
    expect(d.total).toBe(1);
  });
});

describe('selectSurvivors', () => {
  it('drops not-today summaries', () => {
    const { survivors } = selectSurvivors([summary({ isToday: false })], new Set());
    expect(survivors).toEqual([]);
  });

  it('drops a platformOrderNumber already in the seen-set (promotion / split repeat)', () => {
    const { survivors } = selectSurvivors(
      [summary({ platformOrderNumber: 'N1' })],
      new Set(['N1']),
    );
    expect(survivors).toEqual([]);
  });

  it('dedupes within the same window', () => {
    const { survivors, newlySeen } = selectSurvivors(
      [summary({ platformOrderNumber: 'N1' }), summary({ platformOrderNumber: 'N1' })],
      new Set(),
    );
    expect(survivors).toHaveLength(1);
    expect(newlySeen).toEqual(['N1']);
  });

  it('keeps null-platformOrderNumber summaries (cannot dedup by number)', () => {
    const { survivors, newlySeen } = selectSurvivors(
      [summary({ platformOrderNumber: null }), summary({ platformOrderNumber: null })],
      new Set(),
    );
    expect(survivors).toHaveLength(2);
    expect(newlySeen).toEqual([]);
  });
});

describe('planToast', () => {
  it('none when no survivors and no burst', () => {
    expect(planToast([], 0)).toEqual({ kind: 'none' });
  });
  it('single for exactly one survivor', () => {
    const s = summary();
    expect(planToast([s], 0)).toEqual({ kind: 'single', summary: s });
  });
  it('burst for more than one survivor (newest = last)', () => {
    const a = summary({ orderId: 'a' });
    const b = summary({ orderId: 'b' });
    expect(planToast([a, b], 0)).toEqual({ kind: 'burst', count: 2, newest: b });
  });
  it('burstTotal forces a burst even with no survivors', () => {
    expect(planToast([], 9)).toEqual({ kind: 'burst', count: 9, newest: null });
  });
});

describe('shouldPlaySound', () => {
  it('false when disabled', () => {
    expect(
      shouldPlaySound({ soundEnabled: false, hasNotification: true, lastDingAt: null, now: 0 }),
    ).toBe(false);
  });
  it('false with nothing to notify', () => {
    expect(
      shouldPlaySound({ soundEnabled: true, hasNotification: false, lastDingAt: null, now: 0 }),
    ).toBe(false);
  });
  it('true on first ding', () => {
    expect(
      shouldPlaySound({ soundEnabled: true, hasNotification: true, lastDingAt: null, now: 0 }),
    ).toBe(true);
  });
  it('false inside the frequency cap', () => {
    expect(
      shouldPlaySound({
        soundEnabled: true,
        hasNotification: true,
        lastDingAt: 0,
        now: MIN_DING_INTERVAL_MS - 1,
      }),
    ).toBe(false);
  });
  it('true once the cap has elapsed', () => {
    expect(
      shouldPlaySound({
        soundEnabled: true,
        hasNotification: true,
        lastDingAt: 0,
        now: MIN_DING_INTERVAL_MS,
      }),
    ).toBe(true);
  });
});
