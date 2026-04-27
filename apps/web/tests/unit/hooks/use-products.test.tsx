import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useProducts } from '@/features/products/hooks/use-products';
import { ApiError } from '@/lib/api-error';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

const baseArgs = {
  orgId: ORG_ID,
  storeId: STORE_ID,
  page: 1,
  perPage: 25,
  sort: '-platformModifiedAt' as const,
};

function fixtureResponse(overrides: Record<string, unknown> = {}) {
  return {
    data: [
      {
        id: 'p-1',
        productMainId: 'pm-1',
        platformContentId: '1001',
        title: 'Test Product',
        description: null,
        brand: { id: '2032', name: 'Modline' },
        category: { id: '597', name: 'Gömlek' },
        color: 'Beyaz',
        images: [],
        variantCount: 1,
        variants: [
          {
            id: 'v-1',
            platformVariantId: '10010',
            barcode: 'BC-1',
            stockCode: 'SK-1',
            size: 'M',
            salePrice: '100.00',
            listPrice: '100.00',
            vatRate: 20,
            costPrice: null,
            quantity: 5,
            deliveryDuration: 1,
            isRushDelivery: true,
            fastDeliveryOptions: [],
            productUrl: null,
            locationBasedDelivery: 'DISABLED',
            status: 'onSale' as const,
          },
        ],
        lastSyncedAt: '2026-04-27T12:00:00Z',
        platformModifiedAt: '2026-04-26T12:00:00Z',
      },
    ],
    pagination: { page: 1, perPage: 25, total: 1, totalPages: 1 },
    ...overrides,
  };
}

describe('useProducts', () => {
  it('returns the paginated response on success', async () => {
    server.use(
      http.get(`http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/products`, () =>
        HttpResponse.json(fixtureResponse(), { status: 200 }),
      ),
    );

    const { result } = renderHook(() => useProducts(baseArgs), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data).toHaveLength(1);
    expect(result.current.data?.data[0]?.title).toBe('Test Product');
    expect(result.current.data?.pagination.total).toBe(1);
  });

  it('omits empty-string filters from the query string', async () => {
    let capturedUrl = '';
    server.use(
      http.get(
        `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/products`,
        ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json(fixtureResponse(), { status: 200 });
        },
      ),
    );

    const { result } = renderHook(
      () => useProducts({ ...baseArgs, q: '', brandId: '', categoryId: '' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedUrl).not.toContain('q=');
    expect(capturedUrl).not.toContain('brandId=');
    expect(capturedUrl).not.toContain('categoryId=');
    expect(capturedUrl).toContain('page=1');
    expect(capturedUrl).toContain('perPage=25');
    expect(capturedUrl).toContain('sort=-platformModifiedAt');
  });

  it('does not fire when args is null (enabled=false)', () => {
    const { result } = renderHook(() => useProducts(null), { wrapper });
    expect(result.current.isFetching).toBe(false);
    expect(result.current.status).toBe('pending');
  });

  it('surfaces an ApiError on 403', async () => {
    server.use(
      http.get(`http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/products`, () =>
        HttpResponse.json(
          {
            type: 'https://api.pazarsync.com/errors/forbidden',
            title: 'Access denied',
            status: 403,
            code: 'FORBIDDEN',
            detail: 'Not a member',
          },
          { status: 403 },
        ),
      ),
    );

    const { result } = renderHook(() => useProducts(baseArgs), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect((result.current.error as ApiError).code).toBe('FORBIDDEN');
  });
});
