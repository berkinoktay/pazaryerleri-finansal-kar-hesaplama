import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

import type { ProductPricingProfitStatus, ProductPricingSort } from '../query-keys';

export type ProductPricingItem = components['schemas']['ProductPricingItem'];
export type ListProductPricingResponse = components['schemas']['ListProductPricingResponse'];

export interface ListProductPricingArgs {
  orgId: string;
  storeId: string;
  sortBy: ProductPricingSort;
  page: number;
  perPage: number;
  /** Case-insensitive substring match across barcode, SKU, and product name. */
  q?: string;
  /** Forward-profit direction. `all` (or undefined) applies no filter. */
  profitStatus?: ProductPricingProfitStatus;
  /** Minimum / maximum sale margin % (inclusive), decimal strings. */
  marginMin?: string;
  marginMax?: string;
  /** Category / brand ids (bigint as string). */
  categoryId?: string;
  brandId?: string;
}

/**
 * Forward-pricing list for one store. The backend assembles a single-unit
 * profit per APPROVED variant and returns every row (even uncostable ones)
 * so the UI can surface the missing input. All money fields are GROSS,
 * computed server-side — the frontend only renders them.
 *
 * Filters (q / profitStatus / margin range / category / brand) are forwarded
 * only when set: empty strings and the `all` profit status are dropped so the
 * query stays clean and the backend treats them as "no filter".
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
        query: {
          sortBy,
          page,
          perPage,
          ...(args.q !== undefined && args.q.length > 0 ? { q: args.q } : {}),
          ...(args.profitStatus !== undefined && args.profitStatus !== 'all'
            ? { profitStatus: args.profitStatus }
            : {}),
          ...(args.marginMin !== undefined && args.marginMin.length > 0
            ? { marginMin: args.marginMin }
            : {}),
          ...(args.marginMax !== undefined && args.marginMax.length > 0
            ? { marginMax: args.marginMax }
            : {}),
          ...(args.categoryId !== undefined && args.categoryId.length > 0
            ? { categoryId: args.categoryId }
            : {}),
          ...(args.brandId !== undefined && args.brandId.length > 0
            ? { brandId: args.brandId }
            : {}),
        },
      },
    },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
