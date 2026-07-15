'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import {
  updateDiscountSelections,
  type UpdateDiscountSelectionsBody,
  type UpdateDiscountSelectionsResponse,
} from '../api/update-discount-selections.api';
import { discountListKeys } from '../query-keys';

/**
 * Mutation hook for saving per-item participation choices on a discount list. On success
 * invalidates BOTH that list's detail (the persisted inclusion reflects) AND the store's lists
 * (the included/selected count changes). No custom onError — the global pipeline toasts.
 */
export function useUpdateDiscountSelections(
  orgId: string,
  storeId: string,
  listId: string,
): UseMutationResult<UpdateDiscountSelectionsResponse, Error, UpdateDiscountSelectionsBody> {
  const queryClient = useQueryClient();
  return useMutation<UpdateDiscountSelectionsResponse, Error, UpdateDiscountSelectionsBody>({
    mutationFn: (body) => updateDiscountSelections(orgId, storeId, listId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: discountListKeys.detail(orgId, storeId, listId),
      });
      void queryClient.invalidateQueries({
        queryKey: discountListKeys.lists(orgId, storeId),
      });
    },
  });
}
