import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import type { ProductFacetsResponse } from '@/features/products/api/list-product-facets.api';
import type {
  ListProductsResponse,
  VariantSummary,
} from '@/features/products/api/list-products.api';
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
const PATCH_URL = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/products/variants/${VARIANT_ID}/dimensional-weight`;

function wrap(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

// Minimal product-list cache snapshot for the optimistic-update tests. The
// filters mirror the page default, which sends no status (backend scope).
function seedListCache(client: QueryClient, variant: Partial<VariantSummary> = {}) {
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
            ...variant,
          }),
        ],
      }),
    ],
    pagination: { page: 1, perPage: 25, total: 1, totalPages: 1 },
  };
  client.setQueryData(key, snapshot);
  return key;
}

function readVariant(client: QueryClient, key: readonly unknown[]): VariantSummary | undefined {
  return client.getQueryData<ListProductsResponse>(key)?.data[0]?.variants[0];
}

function seedFacetsCache(client: QueryClient) {
  const key = productKeys.facets(ORG_ID, STORE_ID);
  const facets: ProductFacetsResponse = {
    brands: [],
    categories: [],
    overrideCounts: { missingCost: 0, missingDesi: 1, total: 1 },
  };
  client.setQueryData(key, facets);
  return key;
}

// Holds the PATCH response until the test releases it, so the optimistic
// cache state can be read while the request is still in flight.
function gatedPatch(response: Record<string, unknown>): { release: () => void } {
  const gate: { release: () => void } = { release: () => {} };
  const opened = new Promise<void>((resolve) => {
    gate.release = resolve;
  });
  server.use(
    http.patch(PATCH_URL, async () => {
      await opened;
      return HttpResponse.json(response);
    }),
  );
  return gate;
}

describe('useUpdateVariantDimensionalWeight', () => {
  it('PATCHes with the override value and resolves successfully', async () => {
    server.use(
      http.patch(PATCH_URL, async ({ request }) => {
        const body: unknown = await request.json();
        const dimensionalWeight =
          typeof body === 'object' &&
          body !== null &&
          'dimensionalWeight' in body &&
          typeof body.dimensionalWeight === 'string'
            ? body.dimensionalWeight
            : null;
        return HttpResponse.json({
          id: VARIANT_ID,
          dimensionalWeight: dimensionalWeight ?? '1.20',
          syncedDimensionalWeight: '1.20',
          isDimensionalWeightOverridden: dimensionalWeight !== null,
          isDimensionalWeightMissing: false,
        });
      }),
    );

    const client = makeClient();
    const { result } = renderHook(() => useUpdateVariantDimensionalWeight(), {
      wrapper: wrap(client),
    });
    result.current.mutate({
      orgId: ORG_ID,
      storeId: STORE_ID,
      variantId: VARIANT_ID,
      dimensionalWeight: '2.5',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.dimensionalWeight).toBe('2.5');
    expect(result.current.data?.isDimensionalWeightOverridden).toBe(true);
  });

  it('invalidates the facets query so the missing-desi tab badge and tile refresh', async () => {
    server.use(
      http.patch(PATCH_URL, () =>
        HttpResponse.json({
          id: VARIANT_ID,
          dimensionalWeight: '2.5',
          syncedDimensionalWeight: '0',
          isDimensionalWeightOverridden: true,
          isDimensionalWeightMissing: false,
        }),
      ),
    );
    const client = makeClient();
    const facetsKey = seedFacetsCache(client);
    expect(client.getQueryState(facetsKey)?.isInvalidated).toBe(false);

    const { result } = renderHook(() => useUpdateVariantDimensionalWeight(), {
      wrapper: wrap(client),
    });
    result.current.mutate({
      orgId: ORG_ID,
      storeId: STORE_ID,
      variantId: VARIANT_ID,
      dimensionalWeight: '2.5',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await waitFor(() => expect(client.getQueryState(facetsKey)?.isInvalidated).toBe(true));
  });

  it('optimistically clears the missing flag when a desi is entered', async () => {
    const client = makeClient();
    const key = seedListCache(client, {
      dimensionalWeight: '0',
      syncedDimensionalWeight: '0',
      isDimensionalWeightOverridden: false,
      isDimensionalWeightMissing: true,
    });
    const gate = gatedPatch({
      id: VARIANT_ID,
      dimensionalWeight: '1.5',
      syncedDimensionalWeight: '0',
      isDimensionalWeightOverridden: true,
      isDimensionalWeightMissing: false,
    });

    const { result } = renderHook(() => useUpdateVariantDimensionalWeight(), {
      wrapper: wrap(client),
    });
    result.current.mutate({
      orgId: ORG_ID,
      storeId: STORE_ID,
      variantId: VARIANT_ID,
      dimensionalWeight: '1.5',
    });

    await waitFor(() =>
      expect(readVariant(client, key)).toMatchObject({
        dimensionalWeight: '1.5',
        isDimensionalWeightOverridden: true,
        isDimensionalWeightMissing: false,
      }),
    );
    gate.release();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('optimistically flags the variant as missing when the override is cleared and synced is 0', async () => {
    const client = makeClient();
    const key = seedListCache(client, {
      dimensionalWeight: '2.00',
      syncedDimensionalWeight: '0',
      isDimensionalWeightOverridden: true,
      isDimensionalWeightMissing: false,
    });
    const gate = gatedPatch({
      id: VARIANT_ID,
      dimensionalWeight: '0',
      syncedDimensionalWeight: '0',
      isDimensionalWeightOverridden: false,
      isDimensionalWeightMissing: true,
    });

    const { result } = renderHook(() => useUpdateVariantDimensionalWeight(), {
      wrapper: wrap(client),
    });
    result.current.mutate({
      orgId: ORG_ID,
      storeId: STORE_ID,
      variantId: VARIANT_ID,
      dimensionalWeight: null,
    });

    await waitFor(() =>
      expect(readVariant(client, key)).toMatchObject({
        dimensionalWeight: '0',
        isDimensionalWeightOverridden: false,
        isDimensionalWeightMissing: true,
      }),
    );
    gate.release();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("writes the server's desi state into the cache after the save", async () => {
    // A sync refreshed the synced value while the popover was open: the
    // server's answer (synced 2.00, not missing) replaces the optimistic guess.
    server.use(
      http.patch(PATCH_URL, () =>
        HttpResponse.json({
          id: VARIANT_ID,
          dimensionalWeight: '2.00',
          syncedDimensionalWeight: '2.00',
          isDimensionalWeightOverridden: false,
          isDimensionalWeightMissing: false,
        }),
      ),
    );
    const client = makeClient();
    const key = seedListCache(client, {
      dimensionalWeight: '5.00',
      syncedDimensionalWeight: '0',
      isDimensionalWeightOverridden: true,
      isDimensionalWeightMissing: false,
    });

    const { result } = renderHook(() => useUpdateVariantDimensionalWeight(), {
      wrapper: wrap(client),
    });
    result.current.mutate({
      orgId: ORG_ID,
      storeId: STORE_ID,
      variantId: VARIANT_ID,
      dimensionalWeight: null,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(readVariant(client, key)).toMatchObject({
      dimensionalWeight: '2.00',
      syncedDimensionalWeight: '2.00',
      isDimensionalWeightOverridden: false,
      isDimensionalWeightMissing: false,
    });
  });

  it('rolls the products-list cache back to the pre-mutation snapshot when the request fails', async () => {
    const client = makeClient();
    const cacheKey = seedListCache(client);

    server.use(
      http.patch(PATCH_URL, () =>
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
      dimensionalWeight: '5',
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    // After the failure + rollback in onError, the cache returns to the
    // pre-mutation snapshot. onSettled invalidates but doesn't refetch
    // (no useQuery observer in this test), so the snapshot survives.
    expect(readVariant(client, cacheKey)?.dimensionalWeight).toBe('1.20');
  });
});
