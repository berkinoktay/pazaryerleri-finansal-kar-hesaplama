'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import {
  updateFlashSelections,
  type UpdateFlashSelectionsBody,
  type UpdateFlashSelectionsResponse,
} from '../api/update-flash-selections.api';
import { flashProductKeys } from '../query-keys';

/**
 * Mutation hook for saving per-item flash-offer choices + custom prices on a Flash
 * Products list. On success invalidates that list's detail so the persisted selection
 * reflects. No custom onError — the global pipeline toasts.
 */
export function useUpdateFlashSelections(
  orgId: string,
  storeId: string,
  listId: string,
): UseMutationResult<UpdateFlashSelectionsResponse, Error, UpdateFlashSelectionsBody> {
  const queryClient = useQueryClient();
  return useMutation<UpdateFlashSelectionsResponse, Error, UpdateFlashSelectionsBody>({
    mutationFn: (body) => updateFlashSelections(orgId, storeId, listId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: flashProductKeys.detail(orgId, storeId, listId),
      });
    },
  });
}
