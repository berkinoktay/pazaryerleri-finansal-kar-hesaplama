'use client';

import { useMemo } from 'react';

import type { SyncLog } from '../api/list-org-sync-logs.api';
import { useOrgSyncs } from '../providers/org-syncs-provider';

interface UseStoreSyncsResult {
  activeSyncs: SyncLog[];
  recentSyncs: SyncLog[];
}

/**
 * Derived view over useOrgSyncs(): filters to a single store. No
 * additional Realtime channel, no additional REST call — purely a
 * memoized filter over the org-wide cache.
 */
export function useStoreSyncs(storeId: string | null): UseStoreSyncsResult {
  const { activeSyncs, recentSyncs } = useOrgSyncs();
  return useMemo(() => {
    if (storeId === null || storeId.length === 0) {
      return { activeSyncs: [], recentSyncs: [] };
    }
    return {
      activeSyncs: activeSyncs.filter((s) => s.storeId === storeId),
      recentSyncs: recentSyncs.filter((s) => s.storeId === storeId),
    };
  }, [storeId, activeSyncs, recentSyncs]);
}
