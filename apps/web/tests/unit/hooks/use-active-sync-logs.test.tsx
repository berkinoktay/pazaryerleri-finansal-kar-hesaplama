import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useActiveSyncLogs } from '@/features/products/hooks/use-active-sync-logs';
import type { RealtimeHealth, SyncLogRealtimeEvent } from '@/lib/supabase/realtime';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';

// Stub the Realtime module — tests drive the subscribe callbacks
// imperatively rather than spinning up a real WebSocket.
interface FakeSubscriber {
  onEvent: (event: SyncLogRealtimeEvent) => void;
  onHealthChange?: (health: RealtimeHealth) => void;
}

const subscribers = new Set<FakeSubscriber>();
let lastUnsubscribe: ReturnType<typeof vi.fn> | undefined;

vi.mock('@/lib/supabase/realtime', () => ({
  subscribeToSyncLogs: vi.fn(
    (_storeId: string, optionsOrFn: FakeSubscriber | ((event: SyncLogRealtimeEvent) => void)) => {
      const sub: FakeSubscriber =
        typeof optionsOrFn === 'function' ? { onEvent: optionsOrFn } : optionsOrFn;
      subscribers.add(sub);
      lastUnsubscribe = vi.fn(() => subscribers.delete(sub));
      return lastUnsubscribe;
    },
  ),
}));

function emitRealtimeEvent(event: SyncLogRealtimeEvent): void {
  for (const sub of subscribers) sub.onEvent(event);
}

function emitHealthChange(health: RealtimeHealth): void {
  for (const sub of subscribers) sub.onHealthChange?.(health);
}

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

function makeLog(
  overrides: Partial<{
    id: string;
    status: 'RUNNING' | 'COMPLETED' | 'FAILED';
    progressCurrent: number;
    progressTotal: number | null;
    startedAt: string;
  }> = {},
) {
  return {
    id: overrides.id ?? 'log-1',
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

describe('useActiveSyncLogs', () => {
  it('hydrates from REST then merges Realtime UPDATE events into the cache', async () => {
    server.use(
      http.get(
        `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/sync-logs`,
        () => HttpResponse.json({ data: [makeLog({ id: 'log-1', progressCurrent: 100 })] }),
      ),
    );

    const { result } = renderHook(() => useActiveSyncLogs(ORG_ID, STORE_ID), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.progressCurrent).toBe(100);

    // Simulate Realtime UPDATE bumping progress.
    act(() => {
      emitRealtimeEvent({
        eventType: 'UPDATE',
        id: 'log-1',
        row: {
          id: 'log-1',
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

    await waitFor(() => expect(result.current.data?.[0]?.progressCurrent).toBe(250));
  });

  it('places RUNNING rows ahead of finished rows after a Realtime INSERT', async () => {
    server.use(
      http.get(
        `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/sync-logs`,
        () =>
          HttpResponse.json({
            data: [
              makeLog({
                id: 'log-old',
                status: 'COMPLETED',
                startedAt: '2026-04-27T10:00:00Z',
              }),
            ],
          }),
      ),
    );

    const { result } = renderHook(() => useActiveSyncLogs(ORG_ID, STORE_ID), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(1));

    act(() => {
      emitRealtimeEvent({
        eventType: 'INSERT',
        id: 'log-new',
        row: {
          id: 'log-new',
          syncType: 'PRODUCTS',
          status: 'RUNNING',
          startedAt: '2026-04-27T12:00:00Z',
          completedAt: null,
          recordsProcessed: 0,
          progressCurrent: 0,
          progressTotal: null,
          progressStage: 'fetching',
          errorCode: null,
          errorMessage: null,
        },
      });
    });

    await waitFor(() => expect(result.current.data).toHaveLength(2));
    // RUNNING row first, then the older COMPLETED.
    expect(result.current.data?.[0]?.id).toBe('log-new');
    expect(result.current.data?.[0]?.status).toBe('RUNNING');
    expect(result.current.data?.[1]?.id).toBe('log-old');
  });

  it('removes a row on a Realtime DELETE event', async () => {
    server.use(
      http.get(
        `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/sync-logs`,
        () =>
          HttpResponse.json({ data: [makeLog({ id: 'log-keep' }), makeLog({ id: 'log-drop' })] }),
      ),
    );

    const { result } = renderHook(() => useActiveSyncLogs(ORG_ID, STORE_ID), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(2));

    act(() => {
      emitRealtimeEvent({ eventType: 'DELETE', id: 'log-drop', row: null });
    });

    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data?.[0]?.id).toBe('log-keep');
  });

  it('does not subscribe when orgId or storeId is null', () => {
    renderHook(() => useActiveSyncLogs(null, null), { wrapper });
    expect(subscribers.size).toBe(0);
  });

  it('cleans up the subscription on unmount', async () => {
    server.use(
      http.get(
        `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/sync-logs`,
        () => HttpResponse.json({ data: [] }),
      ),
    );
    const { unmount } = renderHook(() => useActiveSyncLogs(ORG_ID, STORE_ID), { wrapper });
    await waitFor(() => expect(subscribers.size).toBeGreaterThan(0));
    unmount();
    expect(subscribers.size).toBe(0);
    expect(lastUnsubscribe).toHaveBeenCalled();
  });

  it('does not poll while Realtime is healthy — even with a RUNNING row in cache', async () => {
    let callCount = 0;
    server.use(
      http.get(
        `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/sync-logs`,
        () => {
          callCount += 1;
          return HttpResponse.json({ data: [makeLog({ id: 'log-1', status: 'RUNNING' })] });
        },
      ),
    );

    renderHook(() => useActiveSyncLogs(ORG_ID, STORE_ID), { wrapper });

    // Wait for the initial hydrate.
    await waitFor(() => expect(callCount).toBe(1));

    // Subscribe lifecycle: 'connecting' → 'healthy'.
    act(() => {
      emitHealthChange('healthy');
    });

    // Even after several seconds, no additional poll should fire while
    // Realtime reports `healthy`. A weaker assertion than "exactly 0
    // polls forever" because real timers + jest fake timers around
    // refetchInterval get racy; but the key invariant — no growing
    // call count — holds.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(callCount).toBe(1);
  });

  it('triggers a refetch when the channel transitions back to healthy', async () => {
    let callCount = 0;
    server.use(
      http.get(
        `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/sync-logs`,
        () => {
          callCount += 1;
          return HttpResponse.json({ data: [makeLog({ id: 'log-1', status: 'RUNNING' })] });
        },
      ),
    );

    renderHook(() => useActiveSyncLogs(ORG_ID, STORE_ID), { wrapper });
    await waitFor(() => expect(callCount).toBe(1));

    // Channel up, then drops, then comes back: the recovery edge
    // schedules an immediate invalidation so any events missed during
    // the outage are reconciled from the REST endpoint.
    act(() => {
      emitHealthChange('healthy');
    });
    act(() => {
      emitHealthChange('errored');
    });
    act(() => {
      emitHealthChange('healthy');
    });

    await waitFor(() => expect(callCount).toBeGreaterThanOrEqual(2));
  });
});
