'use client';

import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import * as React from 'react';

import { subscribeToSyncLogs, type SyncLogRealtimeEvent } from '@/lib/supabase/realtime';

import { listActiveSyncLogs, type SyncLog } from '../api/list-active-sync-logs.api';
import { productKeys } from '../query-keys';

const POLLING_INTERVAL_MS = 2_000;
const RECENT_LIMIT = 5;

/**
 * Active + recent sync logs for a store, with three layers in
 * descending order of preference:
 *
 *   1. **Supabase Realtime** — postgres_changes on `sync_logs`
 *      filtered by `store_id`. Sub-second latency on cache updates;
 *      RLS gates which rows arrive.
 *   2. **Polling fallback** — `refetchInterval` of 2s while any
 *      RUNNING row is in the cache. Catches dropped WebSockets and
 *      makes the UI eventually-consistent even if Realtime is
 *      misbehaving.
 *   3. **Initial hydration** — REST GET on mount to seed the cache
 *      so first paint isn't blocked on a Realtime handshake.
 *
 * The Realtime overlay mutates the React Query cache directly via
 * `setQueryData` so changes propagate to consumers without a refetch.
 */
export function useActiveSyncLogs(
  orgId: string | null,
  storeId: string | null,
): UseQueryResult<SyncLog[]> {
  const queryClient = useQueryClient();
  const isEnabled =
    typeof orgId === 'string' &&
    orgId.length > 0 &&
    typeof storeId === 'string' &&
    storeId.length > 0;

  const query = useQuery<SyncLog[]>({
    queryKey:
      isEnabled && orgId !== null && storeId !== null
        ? productKeys.syncLogs(orgId, storeId)
        : ['products', 'sync-logs', '__disabled__'],
    queryFn: () => {
      if (orgId === null || storeId === null) {
        throw new Error('useActiveSyncLogs called without orgId/storeId');
      }
      return listActiveSyncLogs(orgId, storeId);
    },
    enabled: isEnabled,
    refetchInterval: (q) => {
      const data = q.state.data;
      if (data === undefined) return false;
      const hasRunning = data.some((log) => log.status === 'RUNNING');
      return hasRunning ? POLLING_INTERVAL_MS : false;
    },
  });

  React.useEffect(() => {
    if (!isEnabled || orgId === null || storeId === null) return;
    const queryKey = productKeys.syncLogs(orgId, storeId);
    const unsubscribe = subscribeToSyncLogs(storeId, (event: SyncLogRealtimeEvent) => {
      queryClient.setQueryData<SyncLog[] | undefined>(queryKey, (existing) =>
        applyEvent(existing ?? [], event),
      );
    });
    return unsubscribe;
  }, [isEnabled, orgId, storeId, queryClient]);

  return query;
}

/**
 * Reconcile a Realtime event against the cached list. Active (RUNNING)
 * rows always come first; recent rows are kept newest-first and capped
 * at RECENT_LIMIT to match the REST endpoint's response shape.
 */
function applyEvent(existing: SyncLog[], event: SyncLogRealtimeEvent): SyncLog[] {
  const filtered = existing.filter((log) => log.id !== event.id);

  if (event.eventType === 'DELETE' || event.row === null) {
    return filtered;
  }

  const incoming: SyncLog = {
    id: event.row.id,
    storeId: event.row.storeId,
    syncType: event.row.syncType,
    status: event.row.status,
    startedAt: event.row.startedAt,
    completedAt: event.row.completedAt,
    recordsProcessed: event.row.recordsProcessed,
    progressCurrent: event.row.progressCurrent,
    progressTotal: event.row.progressTotal,
    progressStage: event.row.progressStage,
    errorCode: event.row.errorCode,
    errorMessage: event.row.errorMessage,
  };

  const next = [...filtered, incoming];
  next.sort((a, b) => {
    // Active rows ahead of finished, newest started first within each group.
    const aActive = a.status === 'RUNNING';
    const bActive = b.status === 'RUNNING';
    if (aActive !== bActive) return aActive ? -1 : 1;
    return Date.parse(b.startedAt) - Date.parse(a.startedAt);
  });

  // Cap the recent (non-RUNNING) tail at RECENT_LIMIT so the cache
  // doesn't grow unbounded under a high-event stream.
  const activeCount = next.findIndex((log) => log.status !== 'RUNNING');
  if (activeCount === -1) return next;
  return next.slice(0, activeCount + RECENT_LIMIT);
}
