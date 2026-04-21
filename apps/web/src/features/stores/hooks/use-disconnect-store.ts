'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { disconnectStore } from '../api/disconnect-store.api';
import { storeKeys } from '../query-keys';

export function useDisconnectStore(orgId: string): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: (storeId) => disconnectStore(orgId, storeId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: storeKeys.list(orgId) });
    },
  });
}
