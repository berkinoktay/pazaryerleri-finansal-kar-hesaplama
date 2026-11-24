import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ORDERS_REALTIME_REFRESH_DEBOUNCE_MS,
  ORDERS_REALTIME_REFRESH_MAX_WAIT_MS,
  useOrdersRealtimeRefresh,
} from '@/features/orders/hooks/use-orders-realtime-refresh';
import { publishCompletedDayOrder } from '@/lib/recent-orders-bus';

// The sync worker's buffer-promote tick (BUFFER_PROMOTE_INTERVAL_MS in
// apps/sync-worker/src/index.ts): the midnight flush inserts one chunk of rows
// per tick, so a day's graduation reaches the bus as bursts this far apart.
const BUFFER_PROMOTE_TICK_MS = 5_000;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useOrdersRealtimeRefresh', () => {
  it('invalidates once after a published order id, but only when the quiet period elapses', () => {
    const refresh = vi.fn();
    renderHook(() => useOrdersRealtimeRefresh(refresh));

    // The publish schedules the refetch — nothing fires synchronously.
    act(() => {
      publishCompletedDayOrder('o1');
    });
    expect(refresh).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(ORDERS_REALTIME_REFRESH_DEBOUNCE_MS);
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    // The refresh cancels the max-wait timer too: nothing fires later on its own.
    act(() => {
      vi.advanceTimersByTime(ORDERS_REALTIME_REFRESH_MAX_WAIT_MS);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('coalesces a burst of ids into a single refetch', () => {
    const refresh = vi.fn();
    renderHook(() => useOrdersRealtimeRefresh(refresh));

    act(() => {
      publishCompletedDayOrder('o1');
      publishCompletedDayOrder('o2');
      publishCompletedDayOrder('o3');
    });
    act(() => {
      vi.advanceTimersByTime(ORDERS_REALTIME_REFRESH_DEBOUNCE_MS);
    });

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('an id inside the quiet period restarts it; an id after a refresh starts a new one', () => {
    const refresh = vi.fn();
    renderHook(() => useOrdersRealtimeRefresh(refresh));
    const early = ORDERS_REALTIME_REFRESH_DEBOUNCE_MS - 1_000;

    act(() => {
      publishCompletedDayOrder('o1');
    });
    act(() => {
      vi.advanceTimersByTime(early);
    });
    act(() => {
      publishCompletedDayOrder('o2');
    });
    // o1's quiet period would have ended here; o2 restarted it.
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(refresh).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(ORDERS_REALTIME_REFRESH_DEBOUNCE_MS - 1_000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    act(() => {
      publishCompletedDayOrder('o3');
    });
    act(() => {
      vi.advanceTimersByTime(ORDERS_REALTIME_REFRESH_DEBOUNCE_MS);
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('a burst refreshes once after the quiet period', () => {
    // Premise: one flush tick to the next is quiet for less than the quiet period.
    expect(ORDERS_REALTIME_REFRESH_DEBOUNCE_MS).toBeGreaterThan(BUFFER_PROMOTE_TICK_MS);
    const refresh = vi.fn();
    renderHook(() => useOrdersRealtimeRefresh(refresh));

    // Three flush ticks of a midnight graduation, one tick apart.
    for (let tick = 0; tick < 3; tick += 1) {
      act(() => {
        publishCompletedDayOrder(`tick-${tick}-a`);
        publishCompletedDayOrder(`tick-${tick}-b`);
      });
      act(() => {
        vi.advanceTimersByTime(BUFFER_PROMOTE_TICK_MS);
      });
    }
    expect(refresh).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(ORDERS_REALTIME_REFRESH_DEBOUNCE_MS - BUFFER_PROMOTE_TICK_MS);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a continuous stream refreshes at most once per max wait', () => {
    const refresh = vi.fn();
    renderHook(() => useOrdersRealtimeRefresh(refresh));
    const ticksPerMaxWait = ORDERS_REALTIME_REFRESH_MAX_WAIT_MS / BUFFER_PROMOTE_TICK_MS;

    // One id every flush tick, for two max waits: the quiet period never ends.
    for (let tick = 0; tick < 2 * ticksPerMaxWait; tick += 1) {
      act(() => {
        publishCompletedDayOrder(`o${tick}`);
      });
      act(() => {
        vi.advanceTimersByTime(BUFFER_PROMOTE_TICK_MS);
      });
      if (tick === ticksPerMaxWait - 2) {
        // Just before the first max wait ends: nothing has refreshed yet.
        expect(refresh).not.toHaveBeenCalled();
      }
    }

    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('always calls the latest callback identity (ref-tracked)', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useOrdersRealtimeRefresh(cb), {
      initialProps: { cb: first },
    });

    rerender({ cb: second });

    act(() => {
      publishCompletedDayOrder('o1');
    });
    act(() => {
      vi.advanceTimersByTime(ORDERS_REALTIME_REFRESH_DEBOUNCE_MS);
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('does not fire after unmount', () => {
    const refresh = vi.fn();
    const { unmount } = renderHook(() => useOrdersRealtimeRefresh(refresh));

    act(() => {
      publishCompletedDayOrder('o1');
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(ORDERS_REALTIME_REFRESH_DEBOUNCE_MS);
    });

    expect(refresh).not.toHaveBeenCalled();
  });
});
