'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { ListProductsResponse, VariantSummary } from '../api/list-products.api';
import {
  updateVariantDimensionalWeight,
  type UpdateVariantDimensionalWeightArgs,
  type VariantDimensionalWeightResponse,
} from '../api/update-variant-dimensional-weight.api';
import { productKeys } from '../query-keys';

// Optimistic patch on the products-list cache: walk every page snapshot and
// rewrite the targeted variant's three Desi fields. Computing the effective
// value here keeps the cell's display in sync without a refetch.
function computeEffective(override: string | null, synced: string | null): string | null {
  if (override !== null) return override;
  if (synced !== null) return synced;
  return null;
}

type SnapshotEntry = readonly [readonly unknown[], ListProductsResponse | undefined];

interface MutationContext {
  snapshots: SnapshotEntry[];
}

/**
 * Mutation hook for setting (or clearing, via dimensionalWeight=null) a
 * variant's user override for desi.
 *
 * Optimistic UX: every cached products-list response is patched so the cell
 * updates instantly. On error the snapshots are restored; on settle the list
 * cache is invalidated to reconcile with the server's canonical state.
 *
 * No custom onError toast — the global QueryProvider pipeline handles toasts
 * via ApiError.code translation.
 */
export function useUpdateVariantDimensionalWeight() {
  const queryClient = useQueryClient();

  return useMutation<
    VariantDimensionalWeightResponse,
    Error,
    UpdateVariantDimensionalWeightArgs,
    MutationContext
  >({
    mutationFn: updateVariantDimensionalWeight,
    onMutate: async (variables) => {
      const { orgId, storeId, variantId, dimensionalWeight } = variables;
      const listsKey = productKeys.lists(orgId, storeId);
      await queryClient.cancelQueries({ queryKey: listsKey });

      const snapshots: SnapshotEntry[] = [];
      const matches = queryClient.getQueriesData<ListProductsResponse>({ queryKey: listsKey });
      for (const [key, prev] of matches) {
        snapshots.push([key, prev]);
        if (prev === undefined) continue;
        queryClient.setQueryData<ListProductsResponse>(key, {
          ...prev,
          data: prev.data.map((product) => ({
            ...product,
            variants: product.variants.map((v): VariantSummary => {
              if (v.id !== variantId) return v;
              const effective = computeEffective(dimensionalWeight, v.syncedDimensionalWeight);
              return {
                ...v,
                dimensionalWeight: effective,
                isDimensionalWeightOverridden: dimensionalWeight !== null,
              };
            }),
          })),
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
      void queryClient.invalidateQueries({
        queryKey: productKeys.lists(variables.orgId, variables.storeId),
      });
    },
  });
}
