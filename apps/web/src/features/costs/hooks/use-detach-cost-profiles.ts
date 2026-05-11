'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  detachCostProfiles,
  type DetachCostProfilesArgs,
  type DetachResponse,
} from '../api/detach-cost-profiles.api';
import type { ListVariantCostProfilesResponse } from '../types/cost-profile.types';

import { costsKeys } from './costs-keys';

type SnapshotEntry = readonly [
  readonly (string | number)[],
  ListVariantCostProfilesResponse | undefined,
];

interface MutationContext {
  snapshots: SnapshotEntry[];
}

/**
 * Mutation hook for detaching cost profiles from product variants.
 *
 * Optimistic UX: each variant's `variantAttachments(vid)` cache has the
 * detached `profileIds` filtered out in onMutate so the popover updates
 * immediately. On error the snapshots are restored. On settled, both
 * the per-variant cache, the profile-side attached-variants cache, and
 * the products list are invalidated to reconcile.
 *
 * No custom onError toast — the global QueryProvider pipeline handles toasting.
 */
export function useDetachCostProfiles() {
  const queryClient = useQueryClient();

  return useMutation<DetachResponse, Error, DetachCostProfilesArgs, MutationContext>({
    mutationFn: detachCostProfiles,
    onMutate: async (variables) => {
      const snapshots: SnapshotEntry[] = [];
      const removeIds = new Set(variables.profileIds);
      for (const variantId of variables.variantIds) {
        const key = costsKeys.variantAttachments(variantId);
        await queryClient.cancelQueries({ queryKey: key });
        const prev = queryClient.getQueryData<ListVariantCostProfilesResponse>(key);
        snapshots.push([key, prev] as SnapshotEntry);
        queryClient.setQueryData<ListVariantCostProfilesResponse>(key, (old) => {
          if (old === undefined) return old;
          return { data: old.data.filter((p) => !removeIds.has(p.id)) };
        });
      }
      return { snapshots };
    },
    onError: (_err, _variables, context) => {
      if (context === undefined) return;
      for (const [key, value] of context.snapshots) {
        queryClient.setQueryData(key, value);
      }
    },
    onSettled: (_data, _err, variables) => {
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
      void queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
}
