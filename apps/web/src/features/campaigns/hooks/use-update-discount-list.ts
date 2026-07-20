'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import {
  updateDiscountList,
  type UpdateDiscountListBody,
  type UpdateDiscountListResponse,
} from '../api/update-discount-list.api';
import { discountListKeys } from '../query-keys';

/**
 * Mutation hook for updating a discount list's configuration (discount type + parameters,
 * window, order limit, name). On success invalidates BOTH that list's detail (its discounted
 * scenarios are recomputed on read from the new config) AND the store's lists (the list row
 * shows the configuration). No custom onError — the global pipeline toasts; the config form
 * surfaces VALIDATION_ERROR field issues inline.
 */
export function useUpdateDiscountList(
  orgId: string,
  storeId: string,
  listId: string,
): UseMutationResult<UpdateDiscountListResponse, Error, UpdateDiscountListBody> {
  const queryClient = useQueryClient();
  return useMutation<UpdateDiscountListResponse, Error, UpdateDiscountListBody>({
    mutationFn: (body) => updateDiscountList(orgId, storeId, listId, body),
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
