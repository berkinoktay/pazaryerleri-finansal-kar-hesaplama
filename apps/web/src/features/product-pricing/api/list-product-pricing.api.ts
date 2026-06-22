import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

import type { ProductPricingSort } from '../query-keys';

export type ProductPricingItem = components['schemas']['ProductPricingItem'];
export type ListProductPricingResponse = components['schemas']['ListProductPricingResponse'];

export interface ListProductPricingArgs {
  orgId: string;
  storeId: string;
  sortBy: ProductPricingSort;
  page: number;
  perPage: number;
}

/**
 * Forward-pricing list for one store. The backend assembles a single-unit
 * profit per APPROVED variant and returns every row (even uncostable ones)
 * so the UI can surface the missing input. All money fields are GROSS,
 * computed server-side — the frontend only renders them.
 *
 * Skeleton scope: page / perPage / sortBy only. The q / profitStatus /
 * margin / category / brand filters land in a later slice.
 */
export async function listProductPricing(
  args: ListProductPricingArgs,
): Promise<ListProductPricingResponse> {
  const { orgId, storeId, sortBy, page, perPage } = args;
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/stores/{storeId}/product-pricing',
    {
      params: {
        path: { orgId, storeId },
        query: { sortBy, page, perPage },
      },
    },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
