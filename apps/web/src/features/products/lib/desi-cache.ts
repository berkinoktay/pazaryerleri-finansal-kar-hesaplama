import type { QueryClient, QueryKey } from '@tanstack/react-query';

import type { ListProductsResponse, VariantSummary } from '../api/list-products.api';
import type { VariantDimensionalWeightResponse } from '../api/update-variant-dimensional-weight.api';
import { productKeys } from '../query-keys';

// React Query cache plumbing shared by the single-variant and bulk desi
// mutation hooks: the optimistic patch, its rollback, the server reconcile and
// the invalidation that refreshes the missing-desi tab badge and summary tile.

export type ListSnapshot = readonly [QueryKey, ListProductsResponse | undefined];

/**
 * Optimistic preview of a variant's desi fields after setting (`override` is
 * the dot string being saved) or clearing (`null`) the user override.
 *
 * The missing flag is the backend's (VariantSummary.isDimensionalWeightMissing:
 * no override and no Trendyol desi; a desi of 0 is a real desi). This preview
 * mirrors it only for the moment between the click and the server answer; the
 * PATCH response or the list refetch then replaces it with the backend's own
 * value. The wire carries no digital flag, so clearing the override of a
 * digital variant without a Trendyol desi previews as missing until then.
 */
export function previewVariantDesi(
  variant: VariantSummary,
  override: string | null,
): VariantSummary {
  if (override !== null) {
    return {
      ...variant,
      dimensionalWeight: override,
      isDimensionalWeightOverridden: true,
      isDimensionalWeightMissing: false,
    };
  }
  const synced = variant.syncedDimensionalWeight;
  return {
    ...variant,
    dimensionalWeight: synced,
    isDimensionalWeightOverridden: false,
    isDimensionalWeightMissing: synced === null,
  };
}

/** Copy the server's post-save desi state onto the cached variant. */
export function applyVariantDesiResponse(
  variant: VariantSummary,
  response: VariantDimensionalWeightResponse,
): VariantSummary {
  return {
    ...variant,
    dimensionalWeight: response.dimensionalWeight,
    syncedDimensionalWeight: response.syncedDimensionalWeight,
    isDimensionalWeightOverridden: response.isDimensionalWeightOverridden,
    isDimensionalWeightMissing: response.isDimensionalWeightMissing,
  };
}

/**
 * Rewrite every cached products-list page of the store with `patch` applied
 * to each variant (`patch` returns untouched variants as they are). Returns
 * the pre-patch snapshots for a rollback.
 */
export function patchCachedListVariants(
  queryClient: QueryClient,
  orgId: string,
  storeId: string,
  patch: (variant: VariantSummary) => VariantSummary,
): ListSnapshot[] {
  const snapshots: ListSnapshot[] = [];
  const matches = queryClient.getQueriesData<ListProductsResponse>({
    queryKey: productKeys.lists(orgId, storeId),
  });
  for (const [key, prev] of matches) {
    snapshots.push([key, prev]);
    if (prev === undefined) continue;
    queryClient.setQueryData<ListProductsResponse>(key, {
      ...prev,
      data: prev.data.map((product) => ({ ...product, variants: product.variants.map(patch) })),
    });
  }
  return snapshots;
}

export function restoreListSnapshots(queryClient: QueryClient, snapshots: ListSnapshot[]): void {
  for (const [key, value] of snapshots) {
    queryClient.setQueryData(key, value);
  }
}

/**
 * Reconcile with the server after a desi save: the list pages, and the facets
 * whose `overrideCounts.missingDesi` drives the missing-desi tab badge and the
 * summary tile (facets keep a long staleTime, so without this the badge
 * would lag behind the refetched list).
 */
export function invalidateDesiQueries(
  queryClient: QueryClient,
  orgId: string,
  storeId: string,
): void {
  void queryClient.invalidateQueries({ queryKey: productKeys.lists(orgId, storeId) });
  void queryClient.invalidateQueries({ queryKey: productKeys.facets(orgId, storeId) });
}
