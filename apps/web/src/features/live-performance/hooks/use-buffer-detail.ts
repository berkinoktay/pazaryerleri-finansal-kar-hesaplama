'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { getBufferDetail, type BufferDetail } from '../api/get-buffer-detail.api';
import { liveKeys } from '../query-keys';

export function useBufferDetail(
  orgId: string | null,
  storeId: string | null,
  bufferId: string | null,
): UseQueryResult<BufferDetail> {
  const enabled = orgId !== null && storeId !== null && bufferId !== null;
  return useQuery<BufferDetail>({
    queryKey: enabled
      ? liveKeys.bufferDetail(orgId, storeId, bufferId)
      : [...liveKeys.all, 'buffer-detail', '__disabled__'],
    queryFn: () => {
      if (!enabled) throw new Error('useBufferDetail called without ids');
      return getBufferDetail({ orgId, storeId, bufferId });
    },
    enabled,
  });
}
