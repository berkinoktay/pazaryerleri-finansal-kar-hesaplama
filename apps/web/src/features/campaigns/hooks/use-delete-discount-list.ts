'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { deleteDiscountList } from '../api/delete-discount-list.api';
import { discountListKeys } from '../query-keys';

/**
 * Mutation hook for deleting a discount list. The mutation variable is the `listId`. On success
 * invalidates the store's discount lists. No custom onError — the global pipeline toasts.
 */
export function useDeleteDiscountList(
  orgId: string,
  storeId: string,
): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (listId) => deleteDiscountList(orgId, storeId, listId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: discountListKeys.lists(orgId, storeId),
      });
    },
  });
}
