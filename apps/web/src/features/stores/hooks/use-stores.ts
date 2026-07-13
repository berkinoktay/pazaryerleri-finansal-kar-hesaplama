'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { listStores, type Store } from '../api/list-stores.api';
import { storeKeys } from '../query-keys';

/**
 * Stores of a given org. `silent: true` marks the query with `meta.silent` so
 * the global QueryCache.onError toast is suppressed (see apps/web/CLAUDE.md
 * "Opt out with meta.silent") — used by the switcher's cross-org preview, which
 * renders its own quiet inline error row instead of a global toast.
 */
export function useStores(
  orgId: string | null,
  options?: { initialData?: Store[]; silent?: boolean },
): UseQueryResult<Store[]> {
  return useQuery<Store[]>({
    queryKey: storeKeys.list(orgId ?? ''),
    queryFn: () => listStores(orgId as string),
    enabled: typeof orgId === 'string' && orgId.length > 0,
    initialData: options?.initialData,
    meta: options?.silent === true ? { silent: true } : undefined,
  });
}
