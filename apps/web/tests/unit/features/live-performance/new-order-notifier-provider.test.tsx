import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
// dropped before the coalesce window.
const { getNotificationSummaryMock } = vi.hoisted(() => ({ getNotificationSummaryMock: vi.fn() }));

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

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <NextIntlClientProvider locale="tr" messages={trMessages} timeZone="Europe/Istanbul">
        <NewOrderNotifierProvider>{children}</NewOrderNotifierProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  unsubscribeMock.mockClear();
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
