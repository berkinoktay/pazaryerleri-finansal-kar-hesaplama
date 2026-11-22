import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import type { ProductFacetsResponse } from '@/features/products/api/list-product-facets.api';
import type { ListProductsResponse } from '@/features/products/api/list-products.api';
import { useBulkUpdateVariantDimensionalWeight } from '@/features/products/hooks/use-bulk-update-variant-dimensional-weight';
import { productKeys } from '@/features/products/query-keys';

import { http, HttpResponse, server } from '../../helpers/msw';
import { makeProductWithVariants, makeVariantSummary } from '../../helpers/product-fixtures';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '10000000-0000-0000-0000-000000000001';
const V1 = '20000000-0000-0000-0000-000000000001';
const V2 = '20000000-0000-0000-0000-000000000002';
const BULK_URL = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/products/variants/dimensional-weight`;

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 5 * 60_000, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

function wrap(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

// V1 carries an override over no Trendyol desi (clearing it makes it missing
// again); V2 carries one over a Trendyol desi of 0, a real desi (clearing it
// falls back to 0 and is never missing).
function seedListCache(client: QueryClient) {
  const key = productKeys.list(ORG_ID, STORE_ID, {
    page: 1,
    perPage: 25,
    sort: '-platformCreatedAt',
  });
  const snapshot: ListProductsResponse = {
    data: [
      makeProductWithVariants({
        variants: [
          makeVariantSummary({
            id: V1,
            dimensionalWeight: '3.00',
            syncedDimensionalWeight: null,
            isDimensionalWeightOverridden: true,
            isDimensionalWeightMissing: false,
          }),
          makeVariantSummary({
            id: V2,
            dimensionalWeight: '4.00',
            syncedDimensionalWeight: '0',
            isDimensionalWeightOverridden: true,
            isDimensionalWeightMissing: false,
          }),
        ],
      }),
    ],
    pagination: { page: 1, perPage: 25, total: 1, totalPages: 1 },
  };
  client.setQueryData(key, snapshot);
  return key;
}

function seedFacetsCache(client: QueryClient) {
  const key = productKeys.facets(ORG_ID, STORE_ID);
  const facets: ProductFacetsResponse = {
    brands: [],
    categories: [],
    overrideCounts: { missingCost: 0, missingDesi: 2, total: 2 },
  };
  client.setQueryData(key, facets);
  return key;
}

describe('useBulkUpdateVariantDimensionalWeight', () => {
  it('PATCHes the bulk endpoint with variantIds + value and returns the updated count', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.patch(BULK_URL, async ({ request }) => {
        const body: unknown = await request.json();
        bodies.push(body);
        return HttpResponse.json({ updated: 2 });
      }),
    );

    const { result } = renderHook(() => useBulkUpdateVariantDimensionalWeight(), {
      wrapper: wrap(makeClient()),
    });
    result.current.mutate({
      orgId: ORG_ID,
      storeId: STORE_ID,
      variantIds: [V1, V2],
      dimensionalWeight: '2.5',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(bodies).toEqual([{ variantIds: [V1, V2], dimensionalWeight: '2.5' }]);
    expect(result.current.data?.updated).toBe(2);
  });

  it('invalidates the facets query so the missing-desi tab badge and tile refresh', async () => {
    server.use(http.patch(BULK_URL, () => HttpResponse.json({ updated: 2 })));
    const client = makeClient();
    const facetsKey = seedFacetsCache(client);

    const { result } = renderHook(() => useBulkUpdateVariantDimensionalWeight(), {
      wrapper: wrap(client),
    });
    result.current.mutate({
      orgId: ORG_ID,
      storeId: STORE_ID,
      variantIds: [V1, V2],
      dimensionalWeight: '2.5',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await waitFor(() => expect(client.getQueryState(facetsKey)?.isInvalidated).toBe(true));
  });

  it('optimistically patches the missing flag of every listed variant on clear', async () => {
    const gate: { release: () => void } = { release: () => {} };
    const opened = new Promise<void>((resolve) => {
      gate.release = resolve;
    });
    server.use(
      http.patch(BULK_URL, async () => {
        await opened;
        return HttpResponse.json({ updated: 2 });
      }),
    );
    const client = makeClient();
    const key = seedListCache(client);

    const { result } = renderHook(() => useBulkUpdateVariantDimensionalWeight(), {
      wrapper: wrap(client),
    });
    result.current.mutate({
      orgId: ORG_ID,
      storeId: STORE_ID,
      variantIds: [V1, V2],
      dimensionalWeight: null,
    });

    await waitFor(() => {
      const variants = client.getQueryData<ListProductsResponse>(key)?.data[0]?.variants;
      expect(variants?.[0]).toMatchObject({
        dimensionalWeight: null,
        isDimensionalWeightOverridden: false,
        isDimensionalWeightMissing: true,
      });
      expect(variants?.[1]).toMatchObject({
        dimensionalWeight: '0',
        isDimensionalWeightOverridden: false,
        isDimensionalWeightMissing: false,
      });
    });
    gate.release();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('surfaces server validation errors as ApiError', async () => {
    server.use(
      http.patch(BULK_URL, () =>
        HttpResponse.json(
          {
            type: 'https://api.pazarsync.com/errors/validation',
            title: 'Validation',
            status: 422,
            code: 'VALIDATION_ERROR',
            errors: [{ field: 'dimensionalWeight', code: 'INVALID_DIMENSIONAL_WEIGHT_TOO_LARGE' }],
          },
          { status: 422 },
        ),
      ),
    );

    const { result } = renderHook(() => useBulkUpdateVariantDimensionalWeight(), {
      wrapper: wrap(makeClient()),
    });
    // 1000 is above the inclusive 999.99 ceiling (0 is a valid desi).
    result.current.mutate({
      orgId: ORG_ID,
      storeId: STORE_ID,
      variantIds: [V1],
      dimensionalWeight: '1000',
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
