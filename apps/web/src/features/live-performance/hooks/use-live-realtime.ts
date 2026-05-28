'use client';

import { useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

import { subscribeToLivePerformance, type RealtimeHealth } from '@/lib/supabase/realtime';

import { LIVE_POLL_INTERVAL_MS, liveKeys } from '../query-keys';

/**
 * Wires the store's live-performance Realtime channel to React Query cache
 * invalidation, with a health-gated polling fallback.
 *
 * Three resilience layers (mirrors OrgSyncsProvider):
 *   1. The five query hooks hydrate on mount.
 *   2. Realtime postgres_changes → invalidate `liveKeys.all`. Every panel is a
 *      server-derived aggregate of the same store/day, and any change (new
 *      order, cost attached, promotion) can move more than one panel, so a
 *      single broad invalidate keeps the surface consistent without per-table
 *      key bookkeeping. Refetch only touches mounted queries.
 *   3. Polling fallback — fires ONLY while the channel is `errored`. Healthy →
 *      no poll (Realtime covers it); paused (tab hidden) → no poll (nobody
 *      watching). On recovery from an outage we invalidate once to reconcile
 *      events missed during the gap.
 *
 * Returns the current channel health so the page can surface a "canlı / bağlantı
 * yok" indicator.
 */
export function useLiveRealtime(orgId: string | null, storeId: string | null): RealtimeHealth {
  const queryClient = useQueryClient();
  const [health, setHealth] = React.useState<RealtimeHealth>('connecting');

  React.useEffect(() => {
    if (orgId === null || storeId === null) return;
    return subscribeToLivePerformance(storeId, {
      onEvent: () => {
        void queryClient.invalidateQueries({ queryKey: liveKeys.all });
      },
      onHealthChange: (next) => {
        setHealth((prev) => {
          const wasOutage = prev === 'errored' || prev === 'paused';
          if (next === 'healthy' && wasOutage) {
            void queryClient.invalidateQueries({ queryKey: liveKeys.all });
          }
          return next;
        });
      },
    });
  }, [orgId, storeId, queryClient]);

  React.useEffect(() => {
    if (orgId === null || storeId === null) return;
    if (health !== 'errored') return;
    const intervalId = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: liveKeys.all });
    }, LIVE_POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [health, orgId, storeId, queryClient]);

  return health;
}
