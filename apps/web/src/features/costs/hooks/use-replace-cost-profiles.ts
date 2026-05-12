'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  replaceCostProfiles,
  type ReplaceCostProfilesArgs,
  type ReplaceResponse,
} from '../api/replace-cost-profiles.api';
import type { CostProfile, ListVariantCostProfilesResponse } from '../types/cost-profile.types';

import { costsKeys } from './costs-keys';

export interface UseReplaceCostProfilesVariables extends ReplaceCostProfilesArgs {
  /** Full profile objects to seed the optimistic cache patch. */
  optimisticProfiles?: CostProfile[];
}

type SnapshotEntry = readonly [
  readonly (string | number)[],
  ListVariantCostProfilesResponse | undefined,
];

interface MutationContext {
  snapshots: SnapshotEntry[];
}

/**
 * Mutation hook for atomically replacing the full set of cost profiles on
 * selected product variants.
 *
 * Optimistic UX: each variant's `variantAttachments(vid)` cache is replaced
 * with `optimisticProfiles` in onMutate. On error the snapshots are restored.
 * On settled, both the per-variant cache and the products list are invalidated.
 *
 * No custom onError toast — the global QueryProvider pipeline handles toasting.
 */
export function useReplaceCostProfiles() {
  const queryClient = useQueryClient();

  return useMutation<ReplaceResponse, Error, UseReplaceCostProfilesVariables, MutationContext>({
    mutationFn: replaceCostProfiles,
    onMutate: async (variables) => {
      const snapshots: SnapshotEntry[] = [];
      if (variables.optimisticProfiles === undefined) return { snapshots };

      const replacement = variables.optimisticProfiles;
      for (const variantId of variables.variantIds) {
        const key = costsKeys.variantAttachments(variantId);
        await queryClient.cancelQueries({ queryKey: key });
        const prev = queryClient.getQueryData<ListVariantCostProfilesResponse>(key);
        snapshots.push([key, prev] as SnapshotEntry);
        queryClient.setQueryData<ListVariantCostProfilesResponse>(key, { data: replacement });
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
      for (const variantId of variables.variantIds) {
        void queryClient.invalidateQueries({
          queryKey: costsKeys.variantAttachments(variantId),
        });
      }
      void queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
}
