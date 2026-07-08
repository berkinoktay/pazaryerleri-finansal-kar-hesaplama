import { describe, expect, it } from 'vitest';

import {
  decideCoalesce,
  dedupeEvents,
  isBusinessToday,
  MAX_FETCH_PER_WINDOW,
  MIN_DING_INTERVAL_MS,
  planToast,
  selectSurvivors,
  shouldPlaySound,
  type NewOrderEvent,
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
    status: 'PROCESSING',
    isPromotion: false,
    ...over,
  };
}

function event(over: Partial<NewOrderEvent> = {}): NewOrderEvent {
  // Real orders wire shape: offset-less UTC wall clock (timestamp-without-tz).
  return { table: 'orders', id: 'o1', orderDate: '2026-07-08T09:00:00', ...over };
}

describe('isBusinessToday', () => {
  // Fixtures use the REAL orders wire shape: a timestamp-without-tz UTC wall clock
  // with NO 'Z' / offset (what supabase realtime-js emits for `orders.order_date`).
  it('true when the offset-less wire value maps to today (Istanbul)', () => {
    // now = 2026-07-08 15:00 Istanbul.
    const now = new Date('2026-07-08T12:00:00Z');
    // Wire = the same day's afternoon UTC wall clock, no 'Z'.
    expect(isBusinessToday('2026-07-08T13:00:00', now)).toBe(true);
  });

  it('false for a past business day (backfill / midnight flush)', () => {
    const now = new Date('2026-07-08T12:00:00Z');
    expect(isBusinessToday('2026-07-07T13:00:00', now)).toBe(false);
  });

  // Regression for the timestamp-without-tz parse bug: an order placed just after
  // Istanbul midnight is emitted as a pre-midnight UTC wall clock (UTC+3). Parsing
  // it as local time on an Istanbul browser would misclassify it as yesterday and
  // drop the toast. With the UTC-stamp normalization it must read as today.
  it('true for an after-midnight order whose UTC wall clock is still yesterday-UTC', () => {
    // now = 2026-07-09 00:35 Istanbul (21:35 UTC on the 8th).
    const now = new Date('2026-07-08T21:35:00Z');
    // Wire 22:30 UTC wall clock = 2026-07-09 01:30 Istanbul -> business-today.
    expect(isBusinessToday('2026-07-08T22:30:00', now)).toBe(true);
  });

  it('false for a genuinely-yesterday order at the same after-midnight now', () => {
    const now = new Date('2026-07-08T21:35:00Z');
    // Wire 10:00 UTC = 2026-07-08 13:00 Istanbul -> yesterday relative to now.
    expect(isBusinessToday('2026-07-08T10:00:00', now)).toBe(false);
  });

  it('handles a date-only buffer wire (@db.Date business-date anchor)', () => {
    const now = new Date('2026-07-08T21:35:00Z'); // 2026-07-09 Istanbul
    expect(isBusinessToday('2026-07-09', now)).toBe(true);
    expect(isBusinessToday('2026-07-08', now)).toBe(false);
  });

  it('false for an unparseable date (suspect event never toasts)', () => {
    expect(isBusinessToday('not-a-date', new Date())).toBe(false);
  });
});

describe('dedupeEvents', () => {
  it('drops duplicate ids, preserves first-seen order', () => {
    expect(
      dedupeEvents([
        event({ table: 'orders', id: 'a' }),
        event({ table: 'buffer', id: 'a' }),
        event({ table: 'orders', id: 'b' }),
      ]),
    ).toEqual([event({ table: 'orders', id: 'a' }), event({ table: 'orders', id: 'b' })]);
  });
});

describe('decideCoalesce', () => {
  it('fetch mode at or below cap', () => {
    const events = Array.from({ length: MAX_FETCH_PER_WINDOW }, (_, i) => event({ id: `o${i}` }));
    const d = decideCoalesce(events);
    expect(d.mode).toBe('fetch');
    expect(d.toFetch).toHaveLength(MAX_FETCH_PER_WINDOW);
    expect(d.total).toBe(MAX_FETCH_PER_WINDOW);
  });

  it('burst mode above cap (no per-event fetch)', () => {
    const events = Array.from({ length: MAX_FETCH_PER_WINDOW + 1 }, (_, i) =>
      event({ id: `o${i}` }),
    );
    const d = decideCoalesce(events);
    expect(d.mode).toBe('burst');
    expect(d.toFetch).toEqual([]);
    expect(d.total).toBe(MAX_FETCH_PER_WINDOW + 1);
  });

  it('dedupes before measuring against the cap', () => {
    const dup = event({ id: 'same' });
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

  it('drops a promotion (order already seen as a buffer entry)', () => {
    const { survivors, newlySeen } = selectSurvivors(
      [summary({ isPromotion: true, platformOrderNumber: 'N-PROMO' })],
      new Set(),
    );
    expect(survivors).toEqual([]);
    // A dropped promotion is not recorded in the seen-set.
    expect(newlySeen).toEqual([]);
  });

  it('drops a CANCELLED order', () => {
    const { survivors, newlySeen } = selectSurvivors(
      [summary({ status: 'CANCELLED', platformOrderNumber: 'N-CANCEL' })],
      new Set(),
    );
    expect(survivors).toEqual([]);
    expect(newlySeen).toEqual([]);
  });

  it('drops a first-seen-RETURNED order', () => {
    const { survivors } = selectSurvivors([summary({ status: 'RETURNED' })], new Set());
    expect(survivors).toEqual([]);
  });

  it('keeps a normal today order (not a promotion, live status)', () => {
    const s = summary({ status: 'PROCESSING', isPromotion: false });
    const { survivors, newlySeen } = selectSurvivors([s], new Set());
    expect(survivors).toEqual([s]);
    expect(newlySeen).toEqual(['N1']);
  });

  it('keeps a buffer summary whose status is null', () => {
    const s = summary({ source: 'buffer', status: null, platformOrderNumber: 'N-BUF' });
    const { survivors } = selectSurvivors([s], new Set());
    expect(survivors).toEqual([s]);
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
