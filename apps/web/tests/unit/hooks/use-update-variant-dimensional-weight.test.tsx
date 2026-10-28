import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import type { ListProductsResponse } from '@/features/products/api/list-products.api';
import { useUpdateVariantDimensionalWeight } from '@/features/products/hooks/use-update-variant-dimensional-weight';
import { productKeys } from '@/features/products/query-keys';

import { http, HttpResponse, server } from '../../helpers/msw';
import { makeProductWithVariants, makeVariantSummary } from '../../helpers/product-fixtures';

// Local QueryClient: gcTime is non-zero so a setQueryData-seeded cache entry
// survives an invalidate-without-observer (the standard createTestQueryClient
// uses gcTime: 0, which collects unobserved entries immediately and would
// make these tests measure GC behavior instead of cache rollback).
function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 5 * 60_000, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '10000000-0000-0000-0000-000000000001';
const VARIANT_ID = '20000000-0000-0000-0000-000000000001';

function wrap(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

// Minimal product-list cache snapshot for the optimistic-update tests. The
// filters mirror the page default, which sends no status (backend scope).
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
            id: VARIANT_ID,
            dimensionalWeight: '1.20',
            syncedDimensionalWeight: '1.20',
          }),
        ],
      }),
    ],
    pagination: { page: 1, perPage: 25, total: 1, totalPages: 1 },
  };
  client.setQueryData(key, snapshot);
  return key;
}

describe('useUpdateVariantDimensionalWeight', () => {
  it('PATCHes with the override value and resolves successfully', async () => {
    server.use(
      http.patch(
        `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/products/variants/${VARIANT_ID}/dimensional-weight`,
        async ({ request }) => {
          const body = (await request.json()) as { dimensionalWeight: string | null };
          return HttpResponse.json({
            id: VARIANT_ID,
            dimensionalWeight: body.dimensionalWeight ?? '1.20',
            syncedDimensionalWeight: '1.20',
            isDimensionalWeightOverridden: body.dimensionalWeight !== null,
          });
        },
      ),
    );

    const client = makeClient();
    const { result } = renderHook(() => useUpdateVariantDimensionalWeight(), {
      wrapper: wrap(client),
    });
    result.current.mutate({
      orgId: ORG_ID,
      storeId: STORE_ID,
      variantId: VARIANT_ID,
      dimensionalWeight: '2.50',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.dimensionalWeight).toBe('2.50');
    expect(result.current.data?.isDimensionalWeightOverridden).toBe(true);
  });

  it('rolls the products-list cache back to the pre-mutation snapshot when the request fails', async () => {
    const client = makeClient();
    const cacheKey = seedListCache(client);

    server.use(
      http.patch(
        `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/products/variants/${VARIANT_ID}/dimensional-weight`,
        () =>
          HttpResponse.json(
            {
              type: 'https://api.pazarsync.com/errors/internal',
              title: 'Internal',
              status: 500,
              code: 'INTERNAL_ERROR',
            },
            { status: 500 },
          ),
      ),
    );

    const { result } = renderHook(() => useUpdateVariantDimensionalWeight(), {
      wrapper: wrap(client),
    });
    result.current.mutate({
      orgId: ORG_ID,
      storeId: STORE_ID,
      variantId: VARIANT_ID,
      dimensionalWeight: '5.00',
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    // After the failure + rollback in onError, the cache returns to the
    // pre-mutation snapshot. onSettled invalidates but doesn't refetch
    // (no useQuery observer in this test), so the snapshot survives.
    const snap = client.getQueryData<{
      data: { variants: { id: string; dimensionalWeight: string | null }[] }[];
    }>(cacheKey);
    expect(snap?.data[0]?.variants[0]?.dimensionalWeight).toBe('1.20');
  });
});
