'use client';

import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import * as React from 'react';

import {
  subscribeToOrgSyncs,
  type RealtimeHealth,
  type SyncLogRealtimeEvent,
} from '@/lib/supabase/realtime';

import { listOrgSyncLogs, type SyncFreshness, type SyncLog } from '../api/list-org-sync-logs.api';
import { applySyncLogEvent, type OrgSyncsCache } from '../lib/org-syncs-cache';
import { computeSyncRefetchInterval, isActive } from '../lib/sync-refetch-interval';
import { orgSyncKeys } from '../query-keys';

const EMPTY_CACHE: OrgSyncsCache = { logs: [], freshness: [] };

interface OrgSyncsContextValue {
  activeSyncs: SyncLog[];
  recentSyncs: SyncLog[];
  freshness: SyncFreshness[];
  isLoading: boolean;
}

const ctx = React.createContext<OrgSyncsContextValue | null>(null);

/**
 * Mounts the org-wide Realtime channel for sync_logs and exposes
 * activeSyncs / recentSyncs through context. One channel per user per
 * org — surfaces every sync from every store the user can see, so the
 * dashboard freshness control updates regardless of which page is active.
 *
 * Three resilience layers:
 *   1. REST hydration on mount via listOrgSyncLogs
 *   2. Realtime postgres_changes (subscribeToOrgSyncs) — sub-second
 *      cache updates via setQueryData
 *   3. Polling backstop — an unhealthy channel (errored / connecting)
 *      polls unconditionally; a healthy channel still runs a slow
 *      reconcile floor while a sync is active, because channel
 *      membership is not delivery proof (a dead-but-SUBSCRIBED WAL pipe
 *      would otherwise freeze the progress bar). See
 *      `computeSyncRefetchInterval`. Health is reported by
 *      `subscribeToOrgSyncs` via `onHealthChange`. On `errored` entry
 *      and on `errored`/`paused` → `healthy` recovery we also fire one
 *      `invalidateQueries` to reconcile any events missed around the
 *      outage edges.
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
  // Latches whether we saw a real outage ('errored'/'paused') so the recovery
  // invalidate fires on the way back to 'healthy'. A ref, not a prev-state
  // compare, because buildChannel reports 'connecting' on every (re)subscribe:
  // a prev-vs-next check would only ever see 'connecting' -> 'healthy' and the
  // outage-recovery reconcile would be dead code.
  const hadOutageRef = React.useRef(false);
  // Previous health, tracked as a ref because onHealthChange closes over the
  // effect's initial render (realtimeHealth state would be stale inside it).
  // Used to fire the outage-entry reconcile only on the transition edge INTO
  // 'errored', never on repeated 'errored' emits.
  const prevHealthRef = React.useRef<RealtimeHealth>('connecting');

  const query: UseQueryResult<OrgSyncsCache> = useQuery<OrgSyncsCache>({
    queryKey: isEnabled && orgId !== null ? orgSyncKeys.list(orgId) : ['org-syncs', '__disabled__'],
    queryFn: () => {
      if (orgId === null) {
        throw new Error('OrgSyncsProvider rendered without orgId');
      }
      return listOrgSyncLogs(orgId);
    },
    enabled: isEnabled,
    // `realtimeHealth` is read from render state (not a ref) so each health
    // transition re-renders, React Query re-evaluates this callback, and the
    // new interval takes effect on the next tick instead of a stale one. The
    // liveness backstop keys on the log list, so pass `.logs` (freshness has
    // no bearing on whether an active sync needs a reconcile floor).
    refetchInterval: (q) => computeSyncRefetchInterval(realtimeHealth, q.state.data?.logs),
  });

  React.useEffect(() => {
    if (!isEnabled || orgId === null) return;
    const queryKey = orgSyncKeys.list(orgId);
    return subscribeToOrgSyncs(orgId, {
      onEvent: (event: SyncLogRealtimeEvent) => {
        queryClient.setQueryData<OrgSyncsCache | undefined>(queryKey, (existing) =>
          applySyncLogEvent(existing ?? EMPTY_CACHE, event),
        );
      },
      // R2c delivery watchdog: we expect a steady event stream only while an
      // active sync is in flight. Read live from the cache (not a captured
      // snapshot) so the watchdog reflects the current rows on every check.
      expectDelivery: () => {
        const cache = queryClient.getQueryData<OrgSyncsCache>(queryKey);
        return (cache?.logs ?? []).some((row) => isActive(row.status));
      },
      onHealthChange: (next) => {
        const prev = prevHealthRef.current;
        prevHealthRef.current = next;

        // Outage-entry edge: the moment the channel drops to 'errored' from a
        // non-errored state, refetch once. A silently dead pipe may have never
        // delivered its last events, so the UI must reconcile immediately
        // instead of waiting for the first outage poll tick. Edge-guarded so
        // repeated 'errored' emits don't stack refetches; the initial
        // 'connecting' mount is not 'errored' so it never triggers this.
        if (next === 'errored' && prev !== 'errored') {
          void queryClient.invalidateQueries({ queryKey });
        }

        // Recovery edge: when health returns to healthy after a real outage,
        // refetch once so any events emitted during the outage window get
        // reconciled. Ref-latched (see hadOutageRef) so the interim
        // `connecting` buildChannel emits can't break the gate. The initial
        // `connecting` → `healthy` does NOT trigger this — REST hydrate already
        // ran on mount. The state updater stays pure.
        if (next === 'errored' || next === 'paused') {
          hadOutageRef.current = true;
        } else if (next === 'healthy' && hadOutageRef.current) {
          hadOutageRef.current = false;
          void queryClient.invalidateQueries({ queryKey });
        }
        setRealtimeHealth(next);
      },
    });
  }, [isEnabled, orgId, queryClient]);

  const value = React.useMemo<OrgSyncsContextValue>(() => {
    const cache = query.data ?? EMPTY_CACHE;
    return {
      activeSyncs: cache.logs.filter((s) => isActive(s.status)),
      recentSyncs: cache.logs.filter((s) => !isActive(s.status)),
      freshness: cache.freshness,
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
