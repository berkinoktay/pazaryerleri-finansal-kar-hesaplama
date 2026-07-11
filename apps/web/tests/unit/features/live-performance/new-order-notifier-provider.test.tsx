import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LivePerformanceOrders } from '@/features/live-performance/api/get-live-orders.api';
import type { NotificationSummaryLike } from '@/features/live-performance/lib/new-order-notification-core';
import { LIVE_POLL_INTERVAL_MS, liveKeys } from '@/features/live-performance/query-keys';
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

type LiveOrderRow = LivePerformanceOrders['data'][number];

// Build a full LivePerformanceOrders row — every schema-required field present so
// the fetched list matches what the real endpoint returns.
function orderRow(over: Partial<LiveOrderRow> = {}): LiveOrderRow {
  return {
    source: 'orders',
    platformOrderId: 'PID-1',
    platformOrderNumber: 'N-1',
    orderId: 'o1',
    bufferId: null,
    orderDate: '2026-07-08T09:00:00',
    status: 'PROCESSING',
    revenue: '100.00',
    profit: '25.00',
    margin: '25.00',
    promotionDisplays: null,
    ...over,
  };
}

function listOf(rows: LiveOrderRow[]): LivePerformanceOrders {
  return {
    data: rows,
    total: rows.length,
    counts: { all: rows.length, calculated: rows.length, pending: 0 },
  };
}

// Drive the tab hidden/visible transition the catch-up listens for. happy-dom's
// visibilityState is a getter, so redefine it before dispatching.
function setVisibility(state: 'hidden' | 'visible'): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

const ROW_A = orderRow({ orderId: 'A', platformOrderId: 'PID-A', platformOrderNumber: 'TY-A' });
const ROW_B = orderRow({ orderId: 'B', platformOrderId: 'PID-B', platformOrderNumber: 'TY-B' });

const SUMMARY_B: NotificationSummaryLike = {
  source: 'orders',
  orderId: 'B',
  bufferId: null,
  platformOrderNumber: 'TY-B',
  revenue: '100.00',
  profit: '25.00',
  costStatus: 'costed',
  isToday: true,
  status: 'PROCESSING',
  isPromotion: false,
};

// A distinct second order so two hidden-tab notifications survive the seen-set
// dedup and bump the tab-title badge from (1) to (2).
const SUMMARY_C: NotificationSummaryLike = {
  ...SUMMARY_B,
  orderId: 'C',
  platformOrderNumber: 'TY-C',
};

// Deterministic base tab title so the "(N) " badge assertions are stable; reset
// around every test so one case's prefix never bleeds into the next.
const DEFAULT_TAB_TITLE = 'PazarSync';

// Rendered-title fragments read from the message catalog (no Turkish literals in
// source): the single (rich) toast uses `newOrderTitle`, the catch-up burst uses
// `catchupTitle`.
const SINGLE_TITLE_PREFIX =
  trMessages.livePerformance.realtime.newOrderTitle.split('{amount}')[0] ?? '';

let emitHealthChange: (h: RealtimeHealth) => void = () => {};
let capturedOnNewOrder: (e: NewOrderEventArg) => void = () => {};
const unsubscribeMock = vi.fn();

// Probe the summary fetch: the provider only fetches for events that pass the
// isBusinessToday gate, so the call count tells us whether a past-day event was
// dropped before the coalesce window. toastMock lets us assert the coalesce
// window's toast is suppressed after cancellation. getLiveOrdersMock backs both
// the baseline prime and the tab-return catch-up's list fetch.
const { getNotificationSummaryMock, toastMock, getLiveOrdersMock } = vi.hoisted(() => ({
  getNotificationSummaryMock: vi.fn(),
  toastMock: vi.fn(),
  getLiveOrdersMock: vi.fn(),
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

vi.mock('@/features/live-performance/api/get-live-orders.api', () => ({
  getLiveOrders: getLiveOrdersMock,
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
  // Default: the baseline / catch-up list fetch returns an empty list, so the
  // pre-existing tests are unaffected by the baseline prime that now runs on mount.
  getLiveOrdersMock.mockReset();
  getLiveOrdersMock.mockResolvedValue(listOf([]));
  document.title = DEFAULT_TAB_TITLE;
});
afterEach(() => {
  vi.useRealTimers();
  setVisibility('visible');
  document.title = DEFAULT_TAB_TITLE;
});

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

  // Poll gate: the fallback must run whenever the channel is NOT delivering, i.e.
  // any health that is not 'healthy' and not 'paused'. A channel stuck at
  // 'connecting' previously never polled — the gate now covers it.
  it('polls the fallback while the channel is connecting (not healthy, not paused)', async () => {
    vi.useFakeTimers();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    renderHook(() => useNewOrderNotifier(), { wrapper });

    // Mount health is 'connecting' -> the fallback interval must fire.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_POLL_INTERVAL_MS + 100);
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: liveKeys.all });
  });

  it('does NOT poll while the channel is healthy', async () => {
    vi.useFakeTimers();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    renderHook(() => useNewOrderNotifier(), { wrapper });

    act(() => emitHealthChange('healthy'));
    invalidateSpy.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_POLL_INTERVAL_MS + 100);
    });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('does NOT poll while paused (tab hidden — nobody is watching)', async () => {
    vi.useFakeTimers();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    renderHook(() => useNewOrderNotifier(), { wrapper });

    act(() => emitHealthChange('paused'));
    invalidateSpy.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_POLL_INTERVAL_MS + 100);
    });
    expect(invalidateSpy).not.toHaveBeenCalled();
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

  // Tab-return catch-up: while the tab is hidden the Realtime channel is torn down,
  // so orders that land while away never reach onNewOrder. On return the provider
  // diffs a fresh live-orders list against the session known-set and replays the
  // gap through the same coalesce -> toast/sound window.
  describe('missed-order catch-up', () => {
    it('toasts a single missed order on tab return', async () => {
      getLiveOrdersMock.mockReset();
      getLiveOrdersMock
        .mockResolvedValueOnce(listOf([ROW_A])) // baseline at mount
        .mockResolvedValue(listOf([ROW_A, ROW_B])); // catch-up on return
      getNotificationSummaryMock.mockResolvedValue(SUMMARY_B);

      renderHook(() => useNewOrderNotifier(), { wrapper });
      await waitFor(() => expect(getLiveOrdersMock).toHaveBeenCalledTimes(1));

      act(() => setVisibility('hidden'));
      act(() => setVisibility('visible'));

      await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
      // The rich single toast carries a description (order line); the burst does not.
      expect(toastMock).toHaveBeenCalledWith(
        expect.stringContaining(SINGLE_TITLE_PREFIX),
        expect.objectContaining({ description: expect.any(String) }),
      );
    });

    it('emits ONE catch-up burst toast (no per-order fetch) when more than five are missed', async () => {
      const missed = Array.from({ length: 6 }, (_, i) =>
        orderRow({
          orderId: `B${i}`,
          platformOrderId: `PID-B${i}`,
          platformOrderNumber: `TY-B${i}`,
        }),
      );
      getLiveOrdersMock.mockReset();
      getLiveOrdersMock
        .mockResolvedValueOnce(listOf([ROW_A]))
        .mockResolvedValue(listOf([ROW_A, ...missed]));

      renderHook(() => useNewOrderNotifier(), { wrapper });
      await waitFor(() => expect(getLiveOrdersMock).toHaveBeenCalledTimes(1));

      act(() => setVisibility('hidden'));
      act(() => setVisibility('visible'));

      await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
      // Over the cap -> burst, so no per-order summary fetch.
      expect(getNotificationSummaryMock).not.toHaveBeenCalled();
      const expectedTitle = trMessages.livePerformance.realtime.catchupTitle.replace(
        '{count}',
        String(6),
      );
      expect(toastMock).toHaveBeenCalledWith(expectedTitle, expect.anything());
    });

    it('does NOT re-toast on tab return an order already shown live', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-08T12:00:00Z'));
      getLiveOrdersMock.mockReset();
      getLiveOrdersMock
        .mockResolvedValueOnce(listOf([ROW_A])) // baseline
        .mockResolvedValue(listOf([ROW_A, ROW_B])); // catch-up sees A + B
      getNotificationSummaryMock.mockResolvedValue(SUMMARY_B);

      renderHook(() => useNewOrderNotifier(), { wrapper });
      // Let the baseline prime (knownIds := {orders:A}).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // B arrives live while visible -> coalesce -> one toast, knownIds += orders:B.
      act(() => {
        capturedOnNewOrder({ table: 'orders', id: 'B', orderDate: '2026-07-08T13:00:00' });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COALESCE_WINDOW_MS + 100);
      });
      expect(toastMock).toHaveBeenCalledTimes(1);

      // Tab hidden then visible: catch-up diffs [A, B]; both known -> no 2nd toast.
      act(() => setVisibility('hidden'));
      await act(async () => {
        setVisibility('visible');
        await vi.advanceTimersByTimeAsync(COALESCE_WINDOW_MS + 100);
      });
      expect(toastMock).toHaveBeenCalledTimes(1);
    });

    it('stays silent (fail closed) when the baseline never primed, then works once re-primed', async () => {
      getLiveOrdersMock.mockReset();
      getLiveOrdersMock
        .mockRejectedValueOnce(new Error('baseline unavailable')) // mount prime fails
        .mockResolvedValueOnce(listOf([ROW_A])) // 1st return: re-prime
        .mockResolvedValue(listOf([ROW_A, ROW_B])); // 2nd return: catch-up
      getNotificationSummaryMock.mockResolvedValue(SUMMARY_B);

      renderHook(() => useNewOrderNotifier(), { wrapper });
      await waitFor(() => expect(getLiveOrdersMock).toHaveBeenCalledTimes(1));

      // First return: unprimed baseline -> re-prime and bail, no toast.
      act(() => setVisibility('hidden'));
      act(() => setVisibility('visible'));
      await waitFor(() => expect(getLiveOrdersMock).toHaveBeenCalledTimes(2));
      expect(toastMock).not.toHaveBeenCalled();

      // Second return: now primed -> B is newly missed -> single toast.
      act(() => setVisibility('hidden'));
      act(() => setVisibility('visible'));
      await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    });

    it('stays silent on tab return when nothing new arrived', async () => {
      getLiveOrdersMock.mockReset();
      getLiveOrdersMock.mockResolvedValue(listOf([ROW_A])); // baseline and catch-up identical

      renderHook(() => useNewOrderNotifier(), { wrapper });
      await waitFor(() => expect(getLiveOrdersMock).toHaveBeenCalledTimes(1));

      act(() => setVisibility('hidden'));
      act(() => setVisibility('visible'));
      await waitFor(() => expect(getLiveOrdersMock).toHaveBeenCalledTimes(2));

      expect(toastMock).not.toHaveBeenCalled();
      expect(getNotificationSummaryMock).not.toHaveBeenCalled();
    });

    // Keep-alive regression (#452): the live channel now stays open in a hidden
    // tab, so an order can arrive live (via capturedOnNewOrder) WHILE hidden and
    // toast immediately; on tab return the catch-up diff sees that same order in
    // the fresh list. The shared knownIds gate must stop catch-up from toasting it
    // a second time. This proves keep-alive + catch-up never produce a double toast
    // (the provider needs no change — knownIds already gates it; this only asserts).
    it('does NOT double-toast when an order arrives live while hidden and reappears in the tab-return catch-up', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-08T12:00:00Z'));
      getLiveOrdersMock.mockReset();
      getLiveOrdersMock
        .mockResolvedValueOnce(listOf([ROW_A])) // baseline at mount -> knownIds {orders:A}
        .mockResolvedValue(listOf([ROW_A, ROW_B])); // catch-up on return sees A + B
      getNotificationSummaryMock.mockResolvedValue(SUMMARY_B);

      renderHook(() => useNewOrderNotifier(), { wrapper });
      // Let the baseline prime (knownIds := {orders:A}).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // Tab goes hidden — but the keep-alive channel is still live, so the order
      // event still reaches onNewOrder through capturedOnNewOrder while hidden.
      // onNewOrder synchronously adds orders:B to knownIds and starts the coalesce
      // timer BEFORE the toast (the toast fires later, when the window elapses).
      act(() => setVisibility('hidden'));
      act(() => {
        capturedOnNewOrder({ table: 'orders', id: 'B', orderDate: '2026-07-08T13:00:00' });
      });
      // Coalesce window elapses while hidden -> toast #1 fires for the already-known B.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COALESCE_WINDOW_MS + 100);
      });
      expect(toastMock).toHaveBeenCalledTimes(1);

      // Tab returns -> catch-up diffs the fresh list [A, B] against knownIds. B was
      // already shown live while hidden, so it is known -> NO second toast.
      await act(async () => {
        setVisibility('visible');
        await vi.advanceTimersByTimeAsync(COALESCE_WINDOW_MS + 100);
      });
      expect(toastMock).toHaveBeenCalledTimes(1);
    });
  });

  // Tab-title unread badge: keep-alive (#453) keeps notifications firing while the
  // tab is hidden, so the provider prefixes the document title with a "(N) " count
  // of notifications the seller has not yet seen, and resets it on return.
  describe('tab-title badge', () => {
    it('prefixes the title with the away-count while hidden, incrementing per notification', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-08T12:00:00Z'));
      getNotificationSummaryMock.mockReset();
      getNotificationSummaryMock.mockResolvedValueOnce(SUMMARY_B).mockResolvedValueOnce(SUMMARY_C);

      renderHook(() => useNewOrderNotifier(), { wrapper });
      // Let the baseline prime (empty list -> knownIds stays empty).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      act(() => setVisibility('hidden'));

      // First order arrives live while hidden -> toast + badge (1).
      act(() => {
        capturedOnNewOrder({ table: 'orders', id: 'B', orderDate: '2026-07-08T13:00:00' });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COALESCE_WINDOW_MS + 100);
      });
      expect(document.title).toBe(`(1) ${DEFAULT_TAB_TITLE}`);

      // Second, distinct order -> the badge advances to (2), not a stacked prefix.
      act(() => {
        capturedOnNewOrder({ table: 'orders', id: 'C', orderDate: '2026-07-08T13:00:00' });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COALESCE_WINDOW_MS + 100);
      });
      expect(document.title).toBe(`(2) ${DEFAULT_TAB_TITLE}`);
    });

    it('clears the badge on return and does not re-add it when catch-up finds nothing new', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-08T12:00:00Z'));
      getLiveOrdersMock.mockReset();
      getLiveOrdersMock
        .mockResolvedValueOnce(listOf([])) // baseline at mount -> knownIds empty
        .mockResolvedValue(listOf([ROW_B])); // catch-up on return sees only the known B
      getNotificationSummaryMock.mockReset();
      getNotificationSummaryMock.mockResolvedValue(SUMMARY_B);

      renderHook(() => useNewOrderNotifier(), { wrapper });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // Hidden: an order arrives live -> badge (1).
      act(() => setVisibility('hidden'));
      act(() => {
        capturedOnNewOrder({ table: 'orders', id: 'B', orderDate: '2026-07-08T13:00:00' });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COALESCE_WINDOW_MS + 100);
      });
      expect(document.title).toBe(`(1) ${DEFAULT_TAB_TITLE}`);

      // Return to visible -> badge cleared; catch-up diffs [B] (already known) -> no
      // new toast, so the prefix does not come back.
      await act(async () => {
        setVisibility('visible');
        await vi.advanceTimersByTimeAsync(COALESCE_WINDOW_MS + 100);
      });
      expect(document.title).toBe(DEFAULT_TAB_TITLE);
    });

    it('does NOT bump the badge for an order that arrives while the tab is visible', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-08T12:00:00Z'));
      getNotificationSummaryMock.mockReset();
      getNotificationSummaryMock.mockResolvedValue(SUMMARY_B);

      renderHook(() => useNewOrderNotifier(), { wrapper });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // Tab is visible: an order arrives live -> toast, but the title stays bare.
      act(() => setVisibility('visible'));
      act(() => {
        capturedOnNewOrder({ table: 'orders', id: 'B', orderDate: '2026-07-08T13:00:00' });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COALESCE_WINDOW_MS + 100);
      });
      expect(toastMock).toHaveBeenCalledTimes(1);
      expect(document.title).toBe(DEFAULT_TAB_TITLE);
    });
  });
});
