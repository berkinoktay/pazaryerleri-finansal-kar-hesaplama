import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import type { ListProductsResponse } from '@/features/products/api/list-products.api';
import { useProducts } from '@/features/products/hooks/use-products';
import {
  filtersToListProductsArgs,
  PRODUCT_FILTER_FIELDS,
} from '@/features/products/lib/products-filter-fields';
import {
  PRODUCT_OVERRIDE_MISSING,
  type ProductsFilters,
} from '@/features/products/lib/products-filter-parsers';
import { ApiError } from '@/lib/api-error';

import { makeProductWithVariants } from '../../helpers/product-fixtures';
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

function fixtureResponse(): ListProductsResponse {
  return {
    data: [makeProductWithVariants()],
    pagination: { page: 1, perPage: 25, total: 1, totalPages: 1 },
  };
}

// The products page URL state with no search, no chip and no override tab.
const DEFAULT_PAGE_FILTERS: ProductsFilters = {
  q: '',
  productId: '',
  overrideMissing: null,
  filters: [],
  page: 1,
  perPage: 25,
  sort: '-platformCreatedAt',
};

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

  it('sends no status param for the default page filters (backend listing scope)', async () => {
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
      () => useProducts(filtersToListProductsArgs(ORG_ID, STORE_ID, DEFAULT_PAGE_FILTERS)),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(new URL(capturedUrl).searchParams.has('status')).toBe(false);
  });

  it('forwards a status chip as the status param, DELISTED included', async () => {
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

    const filters: ProductsFilters = {
      ...DEFAULT_PAGE_FILTERS,
      filters: [
        { id: 'r-status', field: PRODUCT_FILTER_FIELDS.status, operator: 'eq', value: 'DELISTED' },
      ],
    };
    const { result } = renderHook(
      () => useProducts(filtersToListProductsArgs(ORG_ID, STORE_ID, filters)),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(new URL(capturedUrl).searchParams.get('status')).toBe('DELISTED');
  });

  it.each(PRODUCT_OVERRIDE_MISSING)('forwards overrideMissing=%s as a query param', async (tab) => {
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

    const { result } = renderHook(() => useProducts({ ...baseArgs, overrideMissing: tab }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(new URL(capturedUrl).searchParams.get('overrideMissing')).toBe(tab);
  });

  it('forwards new sort vocabulary (e.g. -salePrice)', async () => {
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

    const { result } = renderHook(() => useProducts({ ...baseArgs, sort: '-salePrice' }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedUrl).toContain('sort=-salePrice');
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
