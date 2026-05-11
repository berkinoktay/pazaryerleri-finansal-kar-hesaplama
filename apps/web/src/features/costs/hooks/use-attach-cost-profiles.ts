'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  attachCostProfiles,
  type AttachCostProfilesArgs,
  type AttachResponse,
} from '../api/attach-cost-profiles.api';
import type { CostProfile, ListVariantCostProfilesResponse } from '../types/cost-profile.types';

import { costsKeys } from './costs-keys';

/**
 * Variables include an OPTIONAL `optimisticProfiles` field carrying the full
 * profile objects to graft into the per-variant attachment cache before the
 * server round-trip. The API function destructures only `orgId / profileIds /
 * variantIds`, so the extra field is invisible to the wire.
 */
export interface UseAttachCostProfilesVariables extends AttachCostProfilesArgs {
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
 * Mutation hook for attaching cost profiles to product variants.
 *
 * Optimistic UX:
 *   - Each variant's `variantAttachments(vid)` cache is patched in onMutate
 *     so the popover shows the new attached row immediately.
 *   - On error, snapshots are restored.
 *   - On settled, the per-variant cache and the products list are invalidated
 *     so badges/aggregate values reconcile with server state.
 *
 * No custom onError toast — the global QueryProvider pipeline handles toasting.
 */
export function useAttachCostProfiles() {
  const queryClient = useQueryClient();

  return useMutation<AttachResponse, Error, UseAttachCostProfilesVariables, MutationContext>({
    mutationFn: attachCostProfiles,
    onMutate: async (variables) => {
      const snapshots: SnapshotEntry[] = [];
      if (variables.optimisticProfiles === undefined) return { snapshots };

      const newProfiles = variables.optimisticProfiles;
      for (const variantId of variables.variantIds) {
        const key = costsKeys.variantAttachments(variantId);
        await queryClient.cancelQueries({ queryKey: key });
        const prev = queryClient.getQueryData<ListVariantCostProfilesResponse>(key);
        snapshots.push([key, prev] as SnapshotEntry);
        queryClient.setQueryData<ListVariantCostProfilesResponse>(key, (old) => {
          const existing = old?.data ?? [];
          const merged = [...existing];
          for (const p of newProfiles) {
            if (!merged.some((m) => m.id === p.id)) merged.push(p);
          }
          return { data: merged };
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
      for (const variantId of variables.variantIds) {
        void queryClient.invalidateQueries({
          queryKey: costsKeys.variantAttachments(variantId),
        });
      }
      void queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
}
