'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  detachCostProfiles,
  type DetachCostProfilesArgs,
  type DetachResponse,
} from '../api/detach-cost-profiles.api';

import { costsKeys } from './costs-keys';

/**
 * Mutation hook for detaching cost profiles from product variants.
 *
 * Invalidation matrix:
 *   - profileAttachedVariants(profileId) — the attached-variants tab list
 *   - variantAttachments(variantId) — the per-variant side (for PR 9 popover)
 *
 * Invalidates each profileId and variantId pair so both sides stay fresh.
 * No custom onError — the global QueryProvider error pipeline handles toasting.
 */
export function useDetachCostProfiles() {
  const queryClient = useQueryClient();

  return useMutation<DetachResponse, Error, DetachCostProfilesArgs>({
    mutationFn: detachCostProfiles,
    onSuccess: (_data, variables) => {
      for (const profileId of variables.profileIds) {
        void queryClient.invalidateQueries({
          queryKey: costsKeys.profileAttachedVariants(profileId),
        });
      }
      for (const variantId of variables.variantIds) {
        void queryClient.invalidateQueries({
          queryKey: costsKeys.variantAttachments(variantId),
        });
      }
    },
  });
}
