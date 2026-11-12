import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SyncStatus } from '@pazarsync/db/enums';

import { OrgSyncsProvider, useOrgSyncs } from '@/features/sync/providers/org-syncs-provider';
import type { RealtimeHealth, SyncLogRealtimeEvent } from '@/lib/supabase/realtime';

import { createTestQueryClient } from '../../../helpers/render';
import { HttpResponse, http, server } from '../../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';

// Capture the provider's callbacks so each test can drive Realtime
// events and channel-health transitions imperatively. The
// unsubscribeMock lets us assert cleanup on unmount.
let emitRealtimeEvent: (event: SyncLogRealtimeEvent) => void = () => {};
let emitHealthChange: (health: RealtimeHealth) => void = () => {};
const unsubscribeMock = vi.fn();

interface MockOptions {
  onEvent: (event: SyncLogRealtimeEvent) => void;
  onHealthChange?: (health: RealtimeHealth) => void;
}

// The real outage poll waits 10 s. Tests that must observe (or rule out)
// outage polling shrink it to FAST_OUTAGE_POLL_MS by setting
// `pollTiming.outageMs`; the decision table itself stays real (it has its own
// unit test in sync-refetch-interval.test.ts). null = production timing.
const FAST_OUTAGE_POLL_MS = 100;
// Long enough for several fast outage polls — a quiet window proves no polling.
const QUIET_WINDOW_MS = 500;
const pollTiming = vi.hoisted(() => {
  const state: { outageMs: number | null } = { outageMs: null };
  return state;
});

vi.mock('@/features/sync/lib/sync-refetch-interval', async () => {
  const actual = await vi.importActual<typeof import('@/features/sync/lib/sync-refetch-interval')>(
    '@/features/sync/lib/sync-refetch-interval',
  );
  return {
    ...actual,
    computeSyncRefetchInterval: (
      ...args: Parameters<typeof actual.computeSyncRefetchInterval>
    ): number | false => {
      const interval = actual.computeSyncRefetchInterval(...args);
      return interval === actual.OUTAGE_POLL_INTERVAL_MS && pollTiming.outageMs !== null
        ? pollTiming.outageMs
        : interval;
    },
  };
});

vi.mock('@/lib/supabase/realtime', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/supabase/realtime')>('@/lib/supabase/realtime');
  return {
    ...actual,
    subscribeToOrgSyncs: (_orgId: string, options: MockOptions): (() => void) => {
      emitRealtimeEvent = options.onEvent;
      emitHealthChange = options.onHealthChange ?? (() => {});
      return unsubscribeMock;
    },
  };
});

interface MakeLogOverrides {
  id?: string;
  storeId?: string;
  status?: SyncStatus;
  progressCurrent?: number;
  progressTotal?: number | null;
  startedAt?: string;
}

function makeLog(overrides: MakeLogOverrides = {}) {
  return {
    id: overrides.id ?? 'log-1',
    organizationId: ORG_ID,
    storeId: overrides.storeId ?? STORE_ID,
    syncType: 'PRODUCTS' as const,
    status: overrides.status ?? 'RUNNING',
    startedAt: overrides.startedAt ?? '2026-04-27T12:00:00Z',
    completedAt: null,
    recordsProcessed: 0,
    progressCurrent: overrides.progressCurrent ?? 100,
    progressTotal: overrides.progressTotal ?? 500,
    progressStage: 'upserting',
    errorCode: null,
    errorMessage: null,
    attemptCount: 0,
    nextAttemptAt: null,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <OrgSyncsProvider orgId={ORG_ID}>{children}</OrgSyncsProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  pollTiming.outageMs = null;
  unsubscribeMock.mockClear();
  emitRealtimeEvent = () => {};
  emitHealthChange = () => {};
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useOrgSyncs', () => {
  it('hydrates from REST then merges Realtime UPDATE events into the cache', async () => {
    server.use(
      http.get(`http://localhost:3001/v1/organizations/${ORG_ID}/sync-logs`, () =>
        HttpResponse.json({
          data: [makeLog({ id: 'log-1', progressCurrent: 100 })],
          freshness: [],
        }),
      ),
    );

    const { result } = renderHook(() => useOrgSyncs(), { wrapper });
    await waitFor(() => expect(result.current.activeSyncs).toHaveLength(1));
    expect(result.current.activeSyncs[0]?.progressCurrent).toBe(100);

    act(() => {
      emitRealtimeEvent({
        eventType: 'UPDATE',
        id: 'log-1',
        row: {
          id: 'log-1',
          organizationId: ORG_ID,
          storeId: STORE_ID,
          syncType: 'PRODUCTS',
          status: 'RUNNING',
          startedAt: '2026-04-27T12:00:00Z',
          completedAt: null,
          recordsProcessed: 0,
          progressCurrent: 250,
          progressTotal: 500,
          progressStage: 'upserting',
          errorCode: null,
          errorMessage: null,
          attemptCount: 1,
          nextAttemptAt: null,
          skippedPages: null,
        },
      });
    });

    await waitFor(() => expect(result.current.activeSyncs[0]?.progressCurrent).toBe(250));
    // Tenant identity must survive the Realtime → cache round-trip.
    // Channel filter gates rows server-side; the explicit field is
    // defense-in-depth against a future refactor that drops the filter.
    expect(result.current.activeSyncs[0]?.organizationId).toBe(ORG_ID);
  });

  it('does not poll while the channel is healthy and no active syncs exist in the cache', async () => {
    pollTiming.outageMs = FAST_OUTAGE_POLL_MS;
    let getCount = 0;
    server.use(
      http.get(`http://localhost:3001/v1/organizations/${ORG_ID}/sync-logs`, () => {
        getCount += 1;
        return HttpResponse.json({
          data: [
            makeLog({
              id: 'log-done',
              status: 'COMPLETED',
              startedAt: '2026-04-27T10:00:00Z',
            }),
          ],
          freshness: [],
        });
      }),
    );

    const { result } = renderHook(() => useOrgSyncs(), { wrapper });
    // The provider starts `connecting`, which polls unconditionally (outage
    // tempo). Report healthy right away so only the no-active-rows rule decides.
    act(() => {
      emitHealthChange('healthy');
    });
    await waitFor(() => expect(result.current.recentSyncs).toHaveLength(1));
    expect(getCount).toBe(1);

    // Several fast outage intervals pass — the handler must NOT be re-hit
    // because refetchInterval returns false for healthy + no active row.
    await new Promise<void>((resolve) => setTimeout(resolve, QUIET_WINDOW_MS));
    expect(getCount).toBe(1);
  });

  it('polls while a RUNNING sync exists AND the Realtime channel is unhealthy', async () => {
    let getCount = 0;
    server.use(
      http.get(`http://localhost:3001/v1/organizations/${ORG_ID}/sync-logs`, () => {
        getCount += 1;
        return HttpResponse.json({
          data: [makeLog({ id: 'log-running', status: 'RUNNING' })],
          freshness: [],
        });
      }),
    );

    const { result } = renderHook(() => useOrgSyncs(), { wrapper });
    await waitFor(() => expect(result.current.activeSyncs).toHaveLength(1));
    expect(getCount).toBe(1);

    // Drive the channel into `errored` — without a healthy gate, polling
    // is the only thing keeping the cache fresh. Fast timing is switched on
    // only now, so the hydrate count above is not raced by `connecting` polls.
    pollTiming.outageMs = FAST_OUTAGE_POLL_MS;
    act(() => {
      emitHealthChange('errored');
    });

    // The outage-entry edge alone refetches once (count 2); reaching 3 proves
    // the interval is actually polling.
    await waitFor(() => expect(getCount).toBeGreaterThanOrEqual(3), { timeout: 2_000 });
  });

  it('does NOT poll while the Realtime channel is healthy even if a sync is active', async () => {
    let getCount = 0;
    server.use(
      http.get(`http://localhost:3001/v1/organizations/${ORG_ID}/sync-logs`, () => {
        getCount += 1;
        return HttpResponse.json({
          data: [makeLog({ id: 'log-running', status: 'RUNNING' })],
          freshness: [],
        });
      }),
    );

    const { result } = renderHook(() => useOrgSyncs(), { wrapper });
    await waitFor(() => expect(result.current.activeSyncs).toHaveLength(1));
    expect(getCount).toBe(1);

    // Channel reports healthy — Realtime is delivering events directly,
    // so the outage poll must be off (only the 30 s reconcile remains).
    pollTiming.outageMs = FAST_OUTAGE_POLL_MS;
    act(() => {
      emitHealthChange('healthy');
    });

    // Several fast outage intervals pass; the handler must NOT be hit again.
    await new Promise<void>((resolve) => setTimeout(resolve, QUIET_WINDOW_MS));
    expect(getCount).toBe(1);
  });

  it('fires invalidateQueries on outage entry AND on `errored` → `healthy` recovery', async () => {
    let getCount = 0;
    server.use(
      http.get(`http://localhost:3001/v1/organizations/${ORG_ID}/sync-logs`, () => {
        getCount += 1;
        return HttpResponse.json({
          data: [makeLog({ id: 'log-running', status: 'RUNNING' })],
          freshness: [],
        });
      }),
    );

    const { result } = renderHook(() => useOrgSyncs(), { wrapper });
    await waitFor(() => expect(result.current.activeSyncs).toHaveLength(1));
    expect(getCount).toBe(1);

    // Initial connecting → healthy must NOT fire a refetch (REST hydrate
    // already ran on mount).
    act(() => {
      emitHealthChange('healthy');
    });
    // Brief wait — invalidate would have fired immediately.
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    expect(getCount).toBe(1);

    // Outage-entry edge: dropping to `errored` fires one immediate reconcile so
    // a silently dead pipe's missed events get picked up without waiting for the
    // first outage poll tick.
    act(() => {
      emitHealthChange('errored');
    });
    await waitFor(() => expect(getCount).toBe(2), { timeout: 2_000 });

    // Recovery edge: returning to `healthy` after the outage fires a second
    // reconcile for anything emitted during the outage window.
    act(() => {
      emitHealthChange('healthy');
    });
    await waitFor(() => expect(getCount).toBe(3), { timeout: 2_000 });
  });

  it('cleans up the Realtime subscription on unmount', async () => {
    server.use(
      http.get(`http://localhost:3001/v1/organizations/${ORG_ID}/sync-logs`, () =>
        HttpResponse.json({ data: [], freshness: [] }),
      ),
    );

    const { unmount, result } = renderHook(() => useOrgSyncs(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(unsubscribeMock).not.toHaveBeenCalled();
    unmount();
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });

  it('throws when used outside the OrgSyncsProvider', () => {
    function PlainWrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
    }

    // Suppress React's error log for this expected throw.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => renderHook(() => useOrgSyncs(), { wrapper: PlainWrapper })).toThrow(
        /useOrgSyncs must be used inside OrgSyncsProvider/,
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});
