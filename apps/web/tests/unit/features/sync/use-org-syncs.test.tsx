import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgSyncsProvider, useOrgSyncs } from '@/features/sync/providers/org-syncs-provider';
import type { SyncLogRealtimeEvent } from '@/lib/supabase/realtime';

import { createTestQueryClient } from '../../../helpers/render';
import { HttpResponse, http, server } from '../../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';

// Capture the onEvent callback so each test can drive Realtime events
// imperatively. The unsubscribeMock lets us assert cleanup on unmount.
let emitRealtimeEvent: (event: SyncLogRealtimeEvent) => void = () => {};
const unsubscribeMock = vi.fn();

vi.mock('@/lib/supabase/realtime', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/supabase/realtime')>('@/lib/supabase/realtime');
  return {
    ...actual,
    subscribeToOrgSyncs: (
      _orgId: string,
      onEvent: (event: SyncLogRealtimeEvent) => void,
    ): (() => void) => {
      emitRealtimeEvent = onEvent;
      return unsubscribeMock;
    },
  };
});

interface MakeLogOverrides {
  id?: string;
  storeId?: string;
  status?: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'FAILED_RETRYABLE';
  progressCurrent?: number;
  progressTotal?: number | null;
  startedAt?: string;
}

function makeLog(overrides: MakeLogOverrides = {}) {
  return {
    id: overrides.id ?? 'log-1',
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
        },
      });
    });

    await waitFor(() => expect(result.current.activeSyncs[0]?.progressCurrent).toBe(250));
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

  it('polls while a RUNNING sync exists in the cache', async () => {
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

    // Wait past two polling intervals (>=4s); each interval should
    // trigger a refetch because the cache contains a RUNNING row.
    await waitFor(() => expect(getCount).toBeGreaterThanOrEqual(2), {
      timeout: 5_000,
      interval: 200,
    });
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
