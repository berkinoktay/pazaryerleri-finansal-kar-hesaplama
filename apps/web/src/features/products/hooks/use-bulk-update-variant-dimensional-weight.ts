'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { ListProductsResponse, VariantSummary } from '../api/list-products.api';
import {
  bulkUpdateVariantDimensionalWeight,
  type BulkUpdateVariantDimensionalWeightArgs,
  type BulkUpdateVariantDimensionalWeightResponse,
} from '../api/bulk-update-variant-dimensional-weight.api';
import { productKeys } from '../query-keys';

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
 * Bulk mutation hook for setting (or clearing) the user override on many
 * variants at once. Mirrors useUpdateVariantDimensionalWeight's optimistic
 * pattern — every cached products-list page is patched in-place for the
 * listed variant IDs.
 */
export function useBulkUpdateVariantDimensionalWeight() {
  const queryClient = useQueryClient();

  return useMutation<
    BulkUpdateVariantDimensionalWeightResponse,
    Error,
    BulkUpdateVariantDimensionalWeightArgs,
    MutationContext
  >({
    mutationFn: bulkUpdateVariantDimensionalWeight,
    onMutate: async (variables) => {
      const { orgId, storeId, variantIds, dimensionalWeight } = variables;
      const listsKey = productKeys.lists(orgId, storeId);
      await queryClient.cancelQueries({ queryKey: listsKey });

      const idSet = new Set(variantIds);
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
              if (!idSet.has(v.id)) return v;
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
