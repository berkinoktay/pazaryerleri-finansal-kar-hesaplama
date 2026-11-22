'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import {
  updateVariantDimensionalWeight,
  type UpdateVariantDimensionalWeightArgs,
  type VariantDimensionalWeightResponse,
} from '../api/update-variant-dimensional-weight.api';
import {
  applyVariantDesiResponse,
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
 * Mutation hook for setting (or clearing, via dimensionalWeight=null) a
 * variant's user override for desi. Callers pass the canonical dot string
 * from parseDesiInput, never raw input.
 *
 * Optimistic UX: every cached products-list response is patched so the cell
 * (value, override marker and the "Desi gir" call to action) updates
 * instantly. On success the server's post-save state replaces the preview; on
 * error the snapshots are restored; on settle the list and facets caches are
 * invalidated, so the missing-desi tab badge and summary tile follow too.
 *
 * No custom onError toast: the global QueryProvider pipeline handles toasts
 * via ApiError.code translation.
 *
 * `options.onSaved` runs after a successful save, from the mutation's own
 * options, so it fires even if the calling component unmounts before the
 * request settles (a per-call `mutate(vars, { onSuccess })` would not).
 */
export function useUpdateVariantDimensionalWeight(options?: {
  onSaved?: () => void;
}): UseMutationResult<
  VariantDimensionalWeightResponse,
  Error,
  UpdateVariantDimensionalWeightArgs,
  MutationContext
> {
  const queryClient = useQueryClient();

  return useMutation<
    VariantDimensionalWeightResponse,
    Error,
    UpdateVariantDimensionalWeightArgs,
    MutationContext
  >({
    mutationFn: updateVariantDimensionalWeight,
    onMutate: async ({ orgId, storeId, variantId, dimensionalWeight }) => {
      await queryClient.cancelQueries({ queryKey: productKeys.lists(orgId, storeId) });
      const snapshots = patchCachedListVariants(queryClient, orgId, storeId, (v) =>
        v.id === variantId ? previewVariantDesi(v, dimensionalWeight) : v,
      );
      return { snapshots };
    },
    onSuccess: (data, { orgId, storeId }) => {
      patchCachedListVariants(queryClient, orgId, storeId, (v) =>
        v.id === data.id ? applyVariantDesiResponse(v, data) : v,
      );
      options?.onSaved?.();
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
