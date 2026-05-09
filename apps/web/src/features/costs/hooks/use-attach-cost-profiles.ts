'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  attachCostProfiles,
  type AttachCostProfilesArgs,
  type AttachResponse,
} from '../api/attach-cost-profiles.api';

import { costsKeys } from './costs-keys';

/**
 * Mutation hook for attaching cost profiles to product variants.
 *
 * Invalidation matrix:
 *   - variantAttachments(variantId) — the per-variant side (popover list)
 *
 * Optimistic updates are handled at the call site (cost-cell-popover) where
 * more context is available for the cache shape. No custom onError — the
 * global QueryProvider error pipeline handles toasting.
 */
export function useAttachCostProfiles() {
  const queryClient = useQueryClient();

  return useMutation<AttachResponse, Error, AttachCostProfilesArgs>({
    mutationFn: attachCostProfiles,
    onSuccess: (_data, variables) => {
      for (const variantId of variables.variantIds) {
        void queryClient.invalidateQueries({
          queryKey: costsKeys.variantAttachments(variantId),
        });
      }
    },
  });
}
