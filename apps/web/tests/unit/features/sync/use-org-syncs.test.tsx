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
        HttpResponse.json({ data: [makeLog({ id: 'log-1', progressCurrent: 100 })] }),
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

  it('does not poll while no active syncs exist in the cache', async () => {
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
        });
      }),
    );

    const { result } = renderHook(() => useOrgSyncs(), { wrapper });
    await waitFor(() => expect(result.current.recentSyncs).toHaveLength(1));
    expect(getCount).toBe(1);

    // Wait past one polling interval (2s) — handler must NOT be re-hit
    // since refetchInterval returns false when no row is active.
    await new Promise<void>((resolve) => setTimeout(resolve, 2_500));
    expect(getCount).toBe(1);
  });

  it('polls while a RUNNING sync exists AND the Realtime channel is unhealthy', async () => {
    let getCount = 0;
    server.use(
      http.get(`http://localhost:3001/v1/organizations/${ORG_ID}/sync-logs`, () => {
        getCount += 1;
        return HttpResponse.json({
          data: [makeLog({ id: 'log-running', status: 'RUNNING' })],
        });
      }),
    );

    const { result } = renderHook(() => useOrgSyncs(), { wrapper });
    await waitFor(() => expect(result.current.activeSyncs).toHaveLength(1));
    expect(getCount).toBe(1);

    // Drive the channel into `errored` — without a healthy gate, polling
    // is the only thing keeping the cache fresh.
    act(() => {
      emitHealthChange('errored');
    });

    // POLLING_INTERVAL_MS is 10 s; wait ~12 s for at least one poll.
    await waitFor(() => expect(getCount).toBeGreaterThanOrEqual(2), {
      timeout: 12_000,
      interval: 250,
    });
  }, 15_000);

  it('does NOT poll while the Realtime channel is healthy even if a sync is active', async () => {
    let getCount = 0;
    server.use(
      http.get(`http://localhost:3001/v1/organizations/${ORG_ID}/sync-logs`, () => {
        getCount += 1;
        return HttpResponse.json({
          data: [makeLog({ id: 'log-running', status: 'RUNNING' })],
        });
      }),
    );

    const { result } = renderHook(() => useOrgSyncs(), { wrapper });
    await waitFor(() => expect(result.current.activeSyncs).toHaveLength(1));
    expect(getCount).toBe(1);

    // Channel reports healthy — Realtime is delivering events directly,
    // so the polling fallback should be off.
    act(() => {
      emitHealthChange('healthy');
    });

    // Wait noticeably longer than the polling interval (10 s); handler
    // must NOT be hit again. Sub-interval wait would prove nothing.
    await new Promise<void>((resolve) => setTimeout(resolve, 11_000));
    expect(getCount).toBe(1);
  }, 15_000);

  it('fires invalidateQueries on `errored` → `healthy` recovery to reconcile missed events', async () => {
    let getCount = 0;
    server.use(
      http.get(`http://localhost:3001/v1/organizations/${ORG_ID}/sync-logs`, () => {
        getCount += 1;
        return HttpResponse.json({
          data: [makeLog({ id: 'log-running', status: 'RUNNING' })],
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

    // Now simulate an outage and recovery.
    act(() => {
      emitHealthChange('errored');
    });
    act(() => {
      emitHealthChange('healthy');
    });

    // Recovery edge SHOULD fire one invalidate, which triggers a refetch.
    await waitFor(() => expect(getCount).toBe(2), { timeout: 2_000 });
  });

  it('cleans up the Realtime subscription on unmount', async () => {
    server.use(
      http.get(`http://localhost:3001/v1/organizations/${ORG_ID}/sync-logs`, () =>
        HttpResponse.json({ data: [] }),
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
