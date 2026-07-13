import { act, renderHook } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RECENT_ORDER_TTL_MS,
  RecentOrderIdsProvider,
  useRecentOrderIds,
} from '@/features/orders/hooks/use-recent-order-ids';
import { publishRecentOrder } from '@/lib/recent-orders-bus';

function wrapper({ children }: { children: ReactNode }) {
  return <RecentOrderIdsProvider>{children}</RecentOrderIdsProvider>;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useRecentOrderIds', () => {
  it('is empty by default (no provider) — safe fallback', () => {
    const { result } = renderHook(() => useRecentOrderIds());
    expect(result.current.size).toBe(0);
  });

  it('records a published id, then drops it after the TTL', () => {
    const { result } = renderHook(() => useRecentOrderIds(), { wrapper });

    expect(result.current.has('o1')).toBe(false);

    act(() => {
      publishRecentOrder('o1');
    });
    expect(result.current.has('o1')).toBe(true);

    act(() => {
      vi.advanceTimersByTime(RECENT_ORDER_TTL_MS);
    });
    expect(result.current.has('o1')).toBe(false);
  });

  it('keeps each id on its own TTL', () => {
    const { result } = renderHook(() => useRecentOrderIds(), { wrapper });

    act(() => {
      publishRecentOrder('o1');
    });
    act(() => {
      vi.advanceTimersByTime(RECENT_ORDER_TTL_MS / 2);
      publishRecentOrder('o2');
    });
    // o1 still within its window, o2 just added.
    expect(result.current.has('o1')).toBe(true);
    expect(result.current.has('o2')).toBe(true);

    act(() => {
      vi.advanceTimersByTime(RECENT_ORDER_TTL_MS / 2);
    });
    // o1 has now aged out; o2 still has half its window left.
    expect(result.current.has('o1')).toBe(false);
    expect(result.current.has('o2')).toBe(true);
  });
});
