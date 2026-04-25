'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { listStores, type Store } from '../api/list-stores.api';
import { storeKeys } from '../query-keys';

export function useStores(orgId: string | null, initialData?: Store[]): UseQueryResult<Store[]> {
  return useQuery<Store[]>({
    queryKey: storeKeys.list(orgId ?? ''),
    queryFn: () => listStores(orgId as string),
    enabled: typeof orgId === 'string' && orgId.length > 0,
    initialData,
  });
}
