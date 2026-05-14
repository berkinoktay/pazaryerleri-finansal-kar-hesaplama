import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useBulkUpdateVariantDimensionalWeight } from '@/features/products/hooks/use-bulk-update-variant-dimensional-weight';

import { http, HttpResponse, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '10000000-0000-0000-0000-000000000001';
const V1 = '20000000-0000-0000-0000-000000000001';
const V2 = '20000000-0000-0000-0000-000000000002';

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

describe('useBulkUpdateVariantDimensionalWeight', () => {
  it('PATCHes the bulk endpoint with variantIds + value and returns the updated count', async () => {
    let capturedBody: { variantIds: string[]; dimensionalWeight: string | null } | null = null;
    server.use(
      http.patch(
        `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/products/variants/dimensional-weight`,
        async ({ request }) => {
          capturedBody = (await request.json()) as typeof capturedBody;
          return HttpResponse.json({ updated: capturedBody?.variantIds.length ?? 0 });
        },
      ),
    );

    const { result } = renderHook(() => useBulkUpdateVariantDimensionalWeight(), {
      wrapper: wrap(makeClient()),
    });
    result.current.mutate({
      orgId: ORG_ID,
      storeId: STORE_ID,
      variantIds: [V1, V2],
      dimensionalWeight: '2.50',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedBody).toEqual({ variantIds: [V1, V2], dimensionalWeight: '2.50' });
    expect(result.current.data?.updated).toBe(2);
  });

  it('surfaces server validation errors as ApiError', async () => {
    server.use(
      http.patch(
        `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/products/variants/dimensional-weight`,
        () =>
          HttpResponse.json(
            {
              type: 'https://api.pazarsync.com/errors/validation',
              title: 'Validation',
              status: 422,
              code: 'VALIDATION_ERROR',
              errors: [
                { field: 'dimensionalWeight', code: 'INVALID_DIMENSIONAL_WEIGHT_TOO_SMALL' },
              ],
            },
            { status: 422 },
          ),
      ),
    );

    const { result } = renderHook(() => useBulkUpdateVariantDimensionalWeight(), {
      wrapper: wrap(makeClient()),
    });
    result.current.mutate({
      orgId: ORG_ID,
      storeId: STORE_ID,
      variantIds: [V1],
      dimensionalWeight: '0',
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
