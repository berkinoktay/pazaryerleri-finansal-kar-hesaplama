import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ORDERS_REALTIME_REFRESH_DEBOUNCE_MS,
  useOrdersRealtimeRefresh,
} from '@/features/orders/hooks/use-orders-realtime-refresh';
import { publishRecentOrder } from '@/lib/recent-orders-bus';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useOrdersRealtimeRefresh', () => {
  it('invalidates once after a published order id, but only when the window elapses', () => {
    const refresh = vi.fn();
    renderHook(() => useOrdersRealtimeRefresh(refresh));

    // The publish schedules the refetch — nothing fires synchronously.
    act(() => {
      publishRecentOrder('o1');
    });
    expect(refresh).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(ORDERS_REALTIME_REFRESH_DEBOUNCE_MS);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('coalesces a burst of ids into a single refetch', () => {
    const refresh = vi.fn();
    renderHook(() => useOrdersRealtimeRefresh(refresh));

    act(() => {
      publishRecentOrder('o1');
      publishRecentOrder('o2');
      publishRecentOrder('o3');
    });
    act(() => {
      vi.advanceTimersByTime(ORDERS_REALTIME_REFRESH_DEBOUNCE_MS);
    });

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('opens a fresh window for ids that arrive after the previous one fired', () => {
    const refresh = vi.fn();
    renderHook(() => useOrdersRealtimeRefresh(refresh));

    act(() => {
      publishRecentOrder('o1');
    });
    act(() => {
      vi.advanceTimersByTime(ORDERS_REALTIME_REFRESH_DEBOUNCE_MS);
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    act(() => {
      publishRecentOrder('o2');
    });
    act(() => {
      vi.advanceTimersByTime(ORDERS_REALTIME_REFRESH_DEBOUNCE_MS);
    });
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
      publishRecentOrder('o1');
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
      publishRecentOrder('o1');
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(ORDERS_REALTIME_REFRESH_DEBOUNCE_MS);
    });

    expect(refresh).not.toHaveBeenCalled();
  });
});
