import { getBusinessDayRangeOfDate } from '@pazarsync/utils';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ROLLOVER_GRACE_MS,
  ROLLOVER_MAX_RETRIES,
  ROLLOVER_RETRY_MS,
  useBusinessDayRollover,
} from '@/lib/use-business-day-rollover';

// The open date is an argument and the clock is pinned with setSystemTime, so a
// fixed date is deterministic here (it never meets the real "today").
const OPEN_DATE = '2026-05-14';
const NEXT_DATE = '2026-05-15';
const OPEN_DAY_END_MS = getBusinessDayRangeOfDate(OPEN_DATE).end.getTime();
const NEXT_DAY_END_MS = getBusinessDayRangeOfDate(NEXT_DATE).end.getTime();
const BEFORE_END_MS = 5_000;

function setVisibility(state: 'hidden' | 'visible'): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(OPEN_DAY_END_MS - BEFORE_END_MS);
});

afterEach(() => {
  // Restore visibility while the fake clock is still installed, so a re-arm it
  // triggers never schedules a real timer.
  setVisibility('visible');
  vi.useRealTimers();
});

describe('useBusinessDayRollover', () => {
  it('fires once the named business day has ended plus the grace', () => {
    const onRollover = vi.fn();
    renderHook(() => useBusinessDayRollover(OPEN_DATE, onRollover));

    advance(BEFORE_END_MS);
    expect(onRollover).not.toHaveBeenCalled();

    advance(ROLLOVER_GRACE_MS);
    expect(onRollover).toHaveBeenCalledTimes(1);
  });

  it('re-fires every ROLLOVER_RETRY_MS while the date argument is unchanged', () => {
    const onRollover = vi.fn();
    renderHook(() => useBusinessDayRollover(OPEN_DATE, onRollover));

    advance(BEFORE_END_MS + ROLLOVER_GRACE_MS);
    expect(onRollover).toHaveBeenCalledTimes(1);

    advance(ROLLOVER_RETRY_MS);
    advance(ROLLOVER_RETRY_MS);
    expect(onRollover).toHaveBeenCalledTimes(3);
  });

  it('stops re-firing when the date argument advances and schedules the next day', () => {
    const onRollover = vi.fn();
    const { rerender } = renderHook(({ date }) => useBusinessDayRollover(date, onRollover), {
      initialProps: { date: OPEN_DATE },
    });

    advance(BEFORE_END_MS + ROLLOVER_GRACE_MS);
    expect(onRollover).toHaveBeenCalledTimes(1);

    // The refetch brought the server's new open date.
    rerender({ date: NEXT_DATE });
    advance(ROLLOVER_RETRY_MS);
    expect(onRollover).toHaveBeenCalledTimes(1);

    // The next boundary is the end of the new date.
    advance(NEXT_DAY_END_MS + ROLLOVER_GRACE_MS - Date.now());
    expect(onRollover).toHaveBeenCalledTimes(2);
  });

  it('stops after ROLLOVER_MAX_RETRIES', () => {
    const onRollover = vi.fn();
    renderHook(() => useBusinessDayRollover(OPEN_DATE, onRollover));

    advance(BEFORE_END_MS + ROLLOVER_GRACE_MS);
    advance(ROLLOVER_RETRY_MS * ROLLOVER_MAX_RETRIES);
    expect(onRollover).toHaveBeenCalledTimes(1 + ROLLOVER_MAX_RETRIES);

    advance(ROLLOVER_RETRY_MS * 3);
    expect(onRollover).toHaveBeenCalledTimes(1 + ROLLOVER_MAX_RETRIES);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fires immediately (after the grace) when the named day is already over', () => {
    // Client clock ahead of the server: the day the server calls open is over here.
    vi.setSystemTime(OPEN_DAY_END_MS + 60_000);
    const onRollover = vi.fn();
    renderHook(() => useBusinessDayRollover(OPEN_DATE, onRollover));

    advance(ROLLOVER_GRACE_MS);
    expect(onRollover).toHaveBeenCalledTimes(1);
  });

  it('re-arms on visibilitychange', () => {
    // An hour before the end, so the original timer is far from due.
    vi.setSystemTime(OPEN_DAY_END_MS - 3_600_000);
    const onRollover = vi.fn();
    renderHook(() => useBusinessDayRollover(OPEN_DATE, onRollover));

    // A background tab: its timer is throttled, so time passes without it firing.
    setVisibility('hidden');
    vi.setSystemTime(OPEN_DAY_END_MS + 60_000);
    expect(onRollover).not.toHaveBeenCalled();

    act(() => {
      setVisibility('visible');
    });
    advance(ROLLOVER_GRACE_MS);
    expect(onRollover).toHaveBeenCalledTimes(1);
  });

  it('is inert for undefined and clears its timers on unmount', () => {
    const onRollover = vi.fn();
    const inert = renderHook(() => useBusinessDayRollover(undefined, onRollover));
    expect(vi.getTimerCount()).toBe(0);
    advance(BEFORE_END_MS + ROLLOVER_GRACE_MS + ROLLOVER_RETRY_MS);
    expect(onRollover).not.toHaveBeenCalled();
    inert.unmount();

    // Control: a named date arms a timer, and unmount clears it.
    vi.setSystemTime(OPEN_DAY_END_MS - BEFORE_END_MS);
    const armed = renderHook(() => useBusinessDayRollover(OPEN_DATE, onRollover));
    expect(vi.getTimerCount()).toBe(1);
    armed.unmount();
    expect(vi.getTimerCount()).toBe(0);
    advance(BEFORE_END_MS + ROLLOVER_GRACE_MS);
    expect(onRollover).not.toHaveBeenCalled();
  });
});
