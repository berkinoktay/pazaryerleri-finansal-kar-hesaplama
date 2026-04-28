'use client';

import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import * as React from 'react';

import {
  subscribeToOrgSyncs,
  type RealtimeHealth,
  type SyncLogRealtimeEvent,
} from '@/lib/supabase/realtime';

import { listOrgSyncLogs, type SyncLog } from '../api/list-org-sync-logs.api';
import { orgSyncKeys } from '../query-keys';

// 10s, not 2s — polling is now a true fallback (only fires when the
// Realtime channel is unhealthy), so the slower tempo is fine. The
// 2s polling we used pre-PR-#59 burnt ~30 redundant DB queries per
// minute per active merchant during a sync; almost all of those
// duplicated work the WebSocket already did.
const POLLING_INTERVAL_MS = 10_000;
const RECENT_LIMIT = 5;

function isActive(status: SyncLog['status']): boolean {
  return status === 'PENDING' || status === 'RUNNING' || status === 'FAILED_RETRYABLE';
}

interface OrgSyncsContextValue {
  activeSyncs: SyncLog[];
  recentSyncs: SyncLog[];
  isLoading: boolean;
}

const ctx = React.createContext<OrgSyncsContextValue | null>(null);

/**
 * Mounts the org-wide Realtime channel for sync_logs and exposes
 * activeSyncs / recentSyncs through context. One channel per user per
 * org — surfaces every sync from every store the user can see, so the
 * dashboard SyncBadge updates regardless of which page is active.
 *
 * Three resilience layers:
 *   1. REST hydration on mount via listOrgSyncLogs
 *   2. Realtime postgres_changes (subscribeToOrgSyncs) — sub-second
 *      cache updates via setQueryData
 *   3. Polling fallback — fires only when the Realtime channel is NOT
 *      healthy (errored / paused / connecting). Health is reported by
 *      `subscribeToOrgSyncs` via `onHealthChange`. While the channel
 *      is healthy, refetchInterval returns false and we save the DB
 *      the redundant query. On `errored`/`paused` → `healthy` we fire
 *      one `invalidateQueries` to reconcile any events missed during
 *      the outage.
 */
export function OrgSyncsProvider({
  orgId,
  children,
}: {
  orgId: string | null;
  children: React.ReactNode;
}): React.ReactElement {
  const queryClient = useQueryClient();
  const isEnabled = typeof orgId === 'string' && orgId.length > 0;
  // Health is state, not a ref, so transitions trigger a re-render and
  // React Query re-evaluates `refetchInterval` immediately (a ref would
  // let one stale poll fire on the originally-scheduled tick).
  const [realtimeHealth, setRealtimeHealth] = React.useState<RealtimeHealth>('connecting');

  const query: UseQueryResult<SyncLog[]> = useQuery<SyncLog[]>({
    queryKey: isEnabled && orgId !== null ? orgSyncKeys.list(orgId) : ['org-syncs', '__disabled__'],
    queryFn: () => {
      if (orgId === null) {
        throw new Error('OrgSyncsProvider rendered without orgId');
      }
      return listOrgSyncLogs(orgId);
    },
    enabled: isEnabled,
    refetchInterval: (q) => {
      // Polling is a fallback for an unhealthy channel — when Realtime
      // is delivering events we don't need it. `paused` (tab hidden)
      // also returns false because nobody is watching anyway.
      if (realtimeHealth === 'healthy') return false;
      if (realtimeHealth === 'paused') return false;
      const data = q.state.data;
      if (data === undefined) return false;
      return data.some((log) => isActive(log.status)) ? POLLING_INTERVAL_MS : false;
    },
  });

  React.useEffect(() => {
    if (!isEnabled || orgId === null) return;
    const queryKey = orgSyncKeys.list(orgId);
    return subscribeToOrgSyncs(orgId, {
      onEvent: (event: SyncLogRealtimeEvent) => {
        queryClient.setQueryData<SyncLog[] | undefined>(queryKey, (existing) =>
          applyEvent(existing ?? [], event),
        );
      },
      onHealthChange: (next) => {
        setRealtimeHealth((prev) => {
          // Recovery edge: when health flips from a real outage back to
          // healthy, refetch once so any events emitted during the
          // outage window get reconciled. The initial `connecting` →
          // `healthy` does NOT trigger this — REST hydrate already ran
          // on mount.
          const wasOutage = prev === 'errored' || prev === 'paused';
          if (next === 'healthy' && wasOutage) {
            void queryClient.invalidateQueries({ queryKey });
          }
          return next;
        });
      },
    });
  }, [isEnabled, orgId, queryClient]);

  const value = React.useMemo<OrgSyncsContextValue>(() => {
    const all = query.data ?? [];
    return {
      activeSyncs: all.filter((s) => isActive(s.status)),
      recentSyncs: all.filter((s) => !isActive(s.status)),
      isLoading: query.isLoading,
    };
  }, [query.data, query.isLoading]);

  return <ctx.Provider value={value}>{children}</ctx.Provider>;
}

export function useOrgSyncs(): OrgSyncsContextValue {
  const value = React.useContext(ctx);
  if (value === null) {
    throw new Error('useOrgSyncs must be used inside OrgSyncsProvider');
  }
  return value;
}

/**
 * Reconcile a Realtime event against the cached list. Active rows
 * always come first; recent rows are kept newest-first and capped at
 * RECENT_LIMIT to match the REST endpoint's response shape.
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
    const aActive = isActive(a.status);
    const bActive = isActive(b.status);
    if (aActive !== bActive) return aActive ? -1 : 1;
    return Date.parse(b.startedAt) - Date.parse(a.startedAt);
  });

  // Cap the recent (non-active) tail at RECENT_LIMIT so the cache
  // doesn't grow unbounded under a high-event stream.
  const activeCount = next.findIndex((log) => !isActive(log.status));
  if (activeCount === -1) return next;
  return next.slice(0, activeCount + RECENT_LIMIT);
}
