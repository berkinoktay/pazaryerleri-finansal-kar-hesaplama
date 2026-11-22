'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import {
  bulkUpdateVariantDimensionalWeight,
  type BulkUpdateVariantDimensionalWeightArgs,
  type BulkUpdateVariantDimensionalWeightResponse,
} from '../api/bulk-update-variant-dimensional-weight.api';
import {
  invalidateDesiQueries,
  patchCachedListVariants,
  previewVariantDesi,
  restoreListSnapshots,
  type ListSnapshot,
} from '../lib/desi-cache';
import { productKeys } from '../query-keys';

interface MutationContext {
  snapshots: ListSnapshot[];
}

/**
 * The bulk desi mutation as handed to BulkDesiForm. A host that stays mounted
 * for the whole save owns it (the dialog, the parent-row cell), so the pending
 * state outlives the form's DialogContent / PopoverContent.
 */
export type BulkDesiMutation = ReturnType<typeof useBulkUpdateVariantDimensionalWeight>;

/**
 * Bulk mutation hook for setting (or clearing) the user override on many
 * variants at once. Mirrors useUpdateVariantDimensionalWeight's optimistic
 * pattern: every cached products-list page is patched in place for the listed
 * variant IDs (including the missing-desi flag, since clearing an override
 * over no Trendyol desi makes a variant miss desi again; over a Trendyol desi
 * it falls back to that value). The bulk response carries
 * only a count, so the settle-time invalidation of the list and facets caches
 * is what reconciles with the server.
 */
export function useBulkUpdateVariantDimensionalWeight(): UseMutationResult<
  BulkUpdateVariantDimensionalWeightResponse,
  Error,
  BulkUpdateVariantDimensionalWeightArgs,
  MutationContext
> {
  const queryClient = useQueryClient();

  return useMutation<
    BulkUpdateVariantDimensionalWeightResponse,
    Error,
    BulkUpdateVariantDimensionalWeightArgs,
    MutationContext
  >({
    mutationFn: bulkUpdateVariantDimensionalWeight,
    onMutate: async ({ orgId, storeId, variantIds, dimensionalWeight }) => {
      await queryClient.cancelQueries({ queryKey: productKeys.lists(orgId, storeId) });
      const idSet = new Set(variantIds);
      const snapshots = patchCachedListVariants(queryClient, orgId, storeId, (v) =>
        idSet.has(v.id) ? previewVariantDesi(v, dimensionalWeight) : v,
      );
      return { snapshots };
    },
    onError: (_err, _variables, context) => {
      if (context === undefined) return;
      restoreListSnapshots(queryClient, context.snapshots);
    },
    onSettled: (_data, _err, { orgId, storeId }) => {
      invalidateDesiQueries(queryClient, orgId, storeId);
    },
  });
}
