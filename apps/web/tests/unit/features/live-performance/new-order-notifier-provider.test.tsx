import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NotificationSummaryLike } from '@/features/live-performance/lib/new-order-notification-core';
import { liveKeys } from '@/features/live-performance/query-keys';
import type { RealtimeHealth } from '@/lib/supabase/realtime';
import {
  NewOrderNotifierProvider,
  useNewOrderNotifier,
} from '@/features/live-performance/providers/new-order-notifier-provider';

import { createTestQueryClient } from '../../../helpers/render';
import trMessages from '../../../../messages/tr.json';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';

// The provider's coalesce window (COALESCE_WINDOW_MS in the provider). Kept in
// sync here so the fake-timer advance clears exactly one window.
const COALESCE_WINDOW_MS = 1_200;

type NewOrderEventArg = { table: 'orders' | 'buffer'; id: string; orderDate: string };

let emitHealthChange: (h: RealtimeHealth) => void = () => {};
let capturedOnNewOrder: (e: NewOrderEventArg) => void = () => {};
const unsubscribeMock = vi.fn();

// Probe the summary fetch: the provider only fetches for events that pass the
// isBusinessToday gate, so the call count tells us whether a past-day event was
// dropped before the coalesce window. toastMock lets us assert the coalesce
// window's toast is suppressed after cancellation.
const { getNotificationSummaryMock, toastMock } = vi.hoisted(() => ({
  getNotificationSummaryMock: vi.fn(),
  toastMock: vi.fn(),
}));

interface MockOptions {
  onEvent: () => void;
  onNewOrder?: (e: NewOrderEventArg) => void;
  onHealthChange?: (h: RealtimeHealth) => void;
}

vi.mock('@/lib/supabase/realtime', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/supabase/realtime')>('@/lib/supabase/realtime');
  return {
    ...actual,
    subscribeToLivePerformance: (_storeId: string, options: MockOptions): (() => void) => {
      emitHealthChange = options.onHealthChange ?? (() => {});
      capturedOnNewOrder = options.onNewOrder ?? (() => {});
      return unsubscribeMock;
    },
  };
});

vi.mock('@/features/live-performance/api/get-notification-summary.api', () => ({
  getNotificationSummary: getNotificationSummaryMock,
}));

// Deterministic no-op sound: avoids any Web Audio interaction under happy-dom.
vi.mock('@/features/live-performance/lib/play-notification-sound', () => ({
  playNotificationDing: vi.fn(),
  resumeNotificationAudio: vi.fn(),
}));

vi.mock('@/providers/current-scope', () => ({
  useCurrentScope: () => ({ org: { id: ORG_ID }, store: { id: STORE_ID } }),
}));

vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

// Stub the toast surface so a coalesce window's toast is observable (and never
// renders sonner under happy-dom).
vi.mock('@/components/ui/sonner', () => ({ toast: toastMock }));

// Shared across a test so we can spy on invalidateQueries for the outage-recovery
// assertions. Recreated per test in beforeEach.
let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="tr" messages={trMessages} timeZone="Europe/Istanbul">
        <NewOrderNotifierProvider>{children}</NewOrderNotifierProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  queryClient = createTestQueryClient();
  unsubscribeMock.mockClear();
  toastMock.mockClear();
  emitHealthChange = () => {};
  capturedOnNewOrder = () => {};
  getNotificationSummaryMock.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('NewOrderNotifierProvider', () => {
  it('exposes channel health and reflects transitions', async () => {
    const { result } = renderHook(() => useNewOrderNotifier(), { wrapper });
    expect(result.current.health).toBe('connecting');
    act(() => emitHealthChange('healthy'));
    await waitFor(() => expect(result.current.health).toBe('healthy'));
  });

  it('drops a past-day event before the coalesce window, fetches for a today event', async () => {
    vi.useFakeTimers();
    // 2026-07-08 15:00 Istanbul — a mid-day now, safely away from any midnight
    // boundary, so both the drop and the keep are deterministic.
    vi.setSystemTime(new Date('2026-07-08T12:00:00Z'));
    getNotificationSummaryMock.mockResolvedValue({
      source: 'orders',
      orderId: 'ord-today',
      bufferId: null,
      platformOrderNumber: 'TY-TODAY',
      revenue: '100.00',
      profit: '25.00',
      costStatus: 'costed',
      isToday: true,
      status: 'PROCESSING',
      isPromotion: false,
    });

    renderHook(() => useNewOrderNotifier(), { wrapper });

    // Past-day insert (real orders wire shape: offset-less UTC wall clock). The
    // isBusinessToday gate must drop it BEFORE the coalesce window -> no fetch.
    act(() => {
      capturedOnNewOrder({ table: 'orders', id: 'past-1', orderDate: '2026-07-06T13:00:00' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COALESCE_WINDOW_MS + 100);
    });
    expect(getNotificationSummaryMock).not.toHaveBeenCalled();

    // Today insert -> passes the gate -> after the window, the summary is fetched.
    act(() => {
      capturedOnNewOrder({ table: 'orders', id: 'today-1', orderDate: '2026-07-08T13:00:00' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COALESCE_WINDOW_MS + 100);
    });
    expect(getNotificationSummaryMock).toHaveBeenCalledTimes(1);
  });

  it('cleans up the subscription on unmount', () => {
    const { unmount } = renderHook(() => useNewOrderNotifier(), { wrapper });
    expect(unsubscribeMock).not.toHaveBeenCalled();
    unmount();
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });

  // Regression: the recovery invalidate is ref-latched, not a prev-vs-next
  // compare. buildChannel reports an interim 'connecting' between the outage and
  // 'healthy', which a prev-state compare would swallow — turning the tab-return
  // reconcile into dead code.
  it('invalidates live queries on errored -> connecting -> healthy', () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    renderHook(() => useNewOrderNotifier(), { wrapper });
    act(() => emitHealthChange('errored'));
    act(() => emitHealthChange('connecting'));
    act(() => emitHealthChange('healthy'));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: liveKeys.all });
  });

  it('invalidates live queries on paused -> connecting -> healthy (tab return)', () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    renderHook(() => useNewOrderNotifier(), { wrapper });
    act(() => emitHealthChange('paused'));
    act(() => emitHealthChange('connecting'));
    act(() => emitHealthChange('healthy'));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: liveKeys.all });
  });

  it('does NOT invalidate on the initial connecting -> healthy (first connect)', () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    renderHook(() => useNewOrderNotifier(), { wrapper });
    // Mount starts at 'connecting'; the first healthy is the initial connect,
    // not a recovery — REST hydrate already ran, so no reconcile.
    act(() => emitHealthChange('healthy'));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  // Regression (D3): a coalesce window that already started must not fire the
  // previous store's toast after a store switch / unmount cancels it mid-fetch.
  it('suppresses the coalesce toast when the window is cancelled mid-fetch', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-08T12:00:00Z'));

    let resolveFetch: (value: NotificationSummaryLike) => void = () => {};
    getNotificationSummaryMock.mockReturnValue(
      new Promise<NotificationSummaryLike>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const { unmount } = renderHook(() => useNewOrderNotifier(), { wrapper });

    // A today insert enters the coalesce window.
    act(() => {
      capturedOnNewOrder({ table: 'orders', id: 'today-x', orderDate: '2026-07-08T13:00:00' });
    });
    // Fire the coalesce timer so runWindow starts and awaits the (still pending)
    // summary fetch.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COALESCE_WINDOW_MS + 100);
    });
    // Cancel the window before the fetch resolves (store switch / unmount).
    act(() => unmount());
    // Resolve the fetch afterwards -> the post-await guard must drop the toast.
    await act(async () => {
      resolveFetch({
        source: 'orders',
        orderId: 'today-x',
        bufferId: null,
        platformOrderNumber: 'TY-X',
        revenue: '100.00',
        profit: '25.00',
        costStatus: 'costed',
        isToday: true,
        status: 'PROCESSING',
        isPromotion: false,
      });
      await Promise.resolve();
    });

    expect(toastMock).not.toHaveBeenCalled();
  });

  it('throws when used outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() =>
        renderHook(() => useNewOrderNotifier(), {
          wrapper: ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>
          ),
        }),
      ).toThrow(/must be used inside NewOrderNotifierProvider/);
    } finally {
      spy.mockRestore();
    }
  });
});
