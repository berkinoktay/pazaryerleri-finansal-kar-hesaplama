'use client';

import type { SyncType } from '@pazarsync/db/enums';
import * as React from 'react';

import type { SyncLog } from '../api/list-org-sync-logs.api';

/**
 * Fires `onFlowsSettled` once each time one of the watched page-source flows
 * (the active store + `pageSourceTypes`) leaves the active set with a COMPLETED
 * final status. Id-based diff against the previous active set collapses several
 * flows finishing in the same commit into a single call, and a FAILED /
 * FAILED_RETRYABLE exit never fires it.
 *
 * External-system sync (React Query cache reconciliation), so a `useEffect` is
 * the correct tool here: it wires the removed manual "Yenile" button's
 * invalidation to the moment a sync actually completes.
 */
export function useFlowsSettled(params: {
  storeId: string | null;
  pageSourceTypes: ReadonlySet<SyncType>;
  activeSyncs: readonly SyncLog[];
  recentSyncs: readonly SyncLog[];
  onFlowsSettled: (() => void) | undefined;
}): void {
  const { storeId, pageSourceTypes, activeSyncs, recentSyncs, onFlowsSettled } = params;

  const activePageFlowIds = React.useMemo<Set<string>>(() => {
    if (storeId === null) return new Set<string>();
    return new Set(
      activeSyncs
        .filter((s) => s.storeId === storeId && pageSourceTypes.has(s.syncType))
        .map((s) => s.id),
    );
  }, [activeSyncs, storeId, pageSourceTypes]);

  const prevActiveFlowIdsRef = React.useRef<Set<string>>(new Set());
  // Keep the latest callback in a ref so its identity does not re-trigger the
  // detection effect (which must key only on the sync data).
  const onFlowsSettledRef = React.useRef(onFlowsSettled);
  React.useEffect(() => {
    onFlowsSettledRef.current = onFlowsSettled;
  }, [onFlowsSettled]);

  React.useEffect(() => {
    const prev = prevActiveFlowIdsRef.current;
    prevActiveFlowIdsRef.current = activePageFlowIds;
    const settledCompleted = [...prev].some(
      (id) =>
        !activePageFlowIds.has(id) && recentSyncs.find((s) => s.id === id)?.status === 'COMPLETED',
    );
    if (settledCompleted) onFlowsSettledRef.current?.();
  }, [activePageFlowIds, recentSyncs]);
}
