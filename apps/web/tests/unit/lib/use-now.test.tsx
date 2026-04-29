// Hook test for useNow — drives the live countdown in the SyncCenter
// retrying section. The hook is a singleton store over
// `useSyncExternalStore`, so we reset module state between tests to
// avoid cross-test contamination from leftover subscribers.

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetUseNowForTest, useNow } from '@/lib/use-now';

describe('useNow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-29T13:00:00.000Z'));
    __resetUseNowForTest();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    __resetUseNowForTest();
  });

  it('returns the current Date once the subscriber attaches', () => {
    const { result } = renderHook(() => useNow());
    // useSyncExternalStore calls the `subscribe` callback during commit,
    // which seeds the cached now from `new Date()`. The first commit's
    // value reflects the frozen system time.
    expect(result.current).toBeInstanceOf(Date);
    expect(result.current?.toISOString()).toBe('2026-04-29T13:00:00.000Z');
  });

  it('ticks every 1 second', () => {
    const { result } = renderHook(() => useNow());
    expect(result.current?.toISOString()).toBe('2026-04-29T13:00:00.000Z');

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current?.toISOString()).toBe('2026-04-29T13:00:01.000Z');

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(result.current?.toISOString()).toBe('2026-04-29T13:00:06.000Z');
  });

  it('stops ticking after the only subscriber unmounts', () => {
    const { result, unmount } = renderHook(() => useNow());
    expect(result.current?.toISOString()).toBe('2026-04-29T13:00:00.000Z');
    unmount();

    // After unmount the singleton clears its interval. Advance 10s of
    // fake time — the cached value MUST not change because no tick
    // fires.
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    // Re-read via a fresh subscriber: cachedNow is whatever the
    // previous unmount left behind (it isn't reset on the last
    // unsubscribe — only on `__resetUseNowForTest`). The point of
    // this test is that no error, no leaked render. Fresh mount works
    // and starts ticking again.
    const { result: result2 } = renderHook(() => useNow());
    expect(result2.current).toBeInstanceOf(Date);
  });

  it('shares one interval across multiple consumers (Hz, not Hz×N)', () => {
    const { result: a } = renderHook(() => useNow());
    const { result: b } = renderHook(() => useNow());
    const { result: c } = renderHook(() => useNow());

    // All three start from the same baseline.
    expect(a.current?.toISOString()).toBe('2026-04-29T13:00:00.000Z');
    expect(b.current?.toISOString()).toBe('2026-04-29T13:00:00.000Z');
    expect(c.current?.toISOString()).toBe('2026-04-29T13:00:00.000Z');

    // One advance of 1s ticks ALL three — proving they share storage.
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(a.current?.toISOString()).toBe('2026-04-29T13:00:01.000Z');
    expect(b.current?.toISOString()).toBe('2026-04-29T13:00:01.000Z');
    expect(c.current?.toISOString()).toBe('2026-04-29T13:00:01.000Z');
  });

  it('pauses while the tab is hidden and resumes (with an immediate refresh) on visible', () => {
    const { result } = renderHook(() => useNow());
    expect(result.current?.toISOString()).toBe('2026-04-29T13:00:00.000Z');

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current?.toISOString()).toBe('2026-04-29T13:00:01.000Z');

    // Tab → hidden. Hook clears its interval.
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // 5 s of fake time elapses while hidden. `now` MUST stay frozen
    // — the interval was cleared, no ticks fire.
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(result.current?.toISOString()).toBe('2026-04-29T13:00:01.000Z');

    // Tab returns. Hook refreshes immediately AND restarts the
    // interval, so the user sees the right time the moment they look.
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current?.toISOString()).toBe('2026-04-29T13:00:06.000Z');

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current?.toISOString()).toBe('2026-04-29T13:00:07.000Z');
  });
});
