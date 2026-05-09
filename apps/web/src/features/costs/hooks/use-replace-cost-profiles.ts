'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  replaceCostProfiles,
  type ReplaceCostProfilesArgs,
  type ReplaceResponse,
} from '../api/replace-cost-profiles.api';

import { costsKeys } from './costs-keys';

/**
 * Mutation hook for atomically replacing the full set of cost profiles on
 * selected product variants.
 *
 * Invalidation matrix:
 *   - variantAttachments(variantId) per every variant in the call — keeps the
 *     cost-cell popover fresh after replacement.
 *
 * No custom onError — the global QueryProvider error pipeline handles toasting.
 */
export function useReplaceCostProfiles() {
  const queryClient = useQueryClient();

  return useMutation<ReplaceResponse, Error, ReplaceCostProfilesArgs>({
    mutationFn: replaceCostProfiles,
    onSuccess: (_data, variables) => {
      for (const variantId of variables.variantIds) {
        void queryClient.invalidateQueries({
          queryKey: costsKeys.variantAttachments(variantId),
        });
      }
      // Also invalidate the broad products cache so parent-row aggregates
      // re-render after a bulk replace.
      void queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
}
