'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { deleteFlashProducts } from '../api/delete-flash-products.api';
import { flashProductKeys } from '../query-keys';

/**
 * Mutation hook for deleting a Flash Products list. The mutation variable is the `listId`.
 * On success invalidates the store's Flash Products list. No custom onError — the global
 * pipeline toasts.
 */
export function useDeleteFlashProducts(
  orgId: string,
  storeId: string,
): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (listId) => deleteFlashProducts(orgId, storeId, listId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: flashProductKeys.lists(orgId, storeId),
      });
    },
  });
}
