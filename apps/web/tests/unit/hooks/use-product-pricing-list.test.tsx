import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useProductPricingList } from '@/features/product-pricing/hooks/use-product-pricing-list';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const ENDPOINT = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/product-pricing`;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

const baseArgs = {
  orgId: ORG_ID,
  storeId: STORE_ID,
  sortBy: 'salePrice:asc' as const,
  page: 1,
  perPage: 25,
};

function pricingRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'item-1',
    barcode: '8681234567890',
    sku: 'SKU-001',
    title: 'Test Ürün',
    salePrice: '299.99',
    netProfit: '45.12',
    saleMarginPct: '15.04',
    costMarkupPct: '17.71',
    calculable: true,
    profitStatus: 'profitable',
    costStatus: null,
    shippingStatus: null,
    commissionStatus: null,
    categoryId: '100',
    categoryName: 'Kategori A',
    brandId: '200',
    brandName: 'Marka B',
    imageUrl: null,
    ...overrides,
  };
}

function fixtureResponse(
  rows: ReturnType<typeof pricingRow>[],
  pagination: Partial<{ page: number; perPage: number; total: number; totalPages: number }> = {},
) {
  return {
    data: rows,
    pagination: { page: 1, perPage: 25, total: rows.length, totalPages: 1, ...pagination },
  };
}

describe('useProductPricingList', () => {
  it('returns list rows and pagination on success', async () => {
    server.use(
      http.get(ENDPOINT, () => HttpResponse.json(fixtureResponse([pricingRow()]), { status: 200 })),
    );

    const { result } = renderHook(() => useProductPricingList(baseArgs), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data).toHaveLength(1);
    expect(result.current.data?.data[0].barcode).toBe('8681234567890');
    expect(result.current.data?.pagination.page).toBe(1);
    expect(result.current.data?.pagination.total).toBe(1);
  });

  it('does not fetch when args is null (enabled=false path)', () => {
    const { result } = renderHook(() => useProductPricingList(null), { wrapper });
    expect(result.current.isFetching).toBe(false);
    expect(result.current.status).toBe('pending');
  });

  it('omits empty q / marginMin / marginMax / categoryId / brandId from the request URL', async () => {
    let capturedUrl = '';
    server.use(
      http.get(ENDPOINT, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(fixtureResponse([]), { status: 200 });
      }),
    );

    const { result } = renderHook(
      () =>
        useProductPricingList({
          ...baseArgs,
          q: '',
          marginMin: '',
          marginMax: '',
          categoryId: '',
          brandId: '',
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const params = new URL(capturedUrl).searchParams;
    expect(params.has('q')).toBe(false);
    expect(params.has('marginMin')).toBe(false);
    expect(params.has('marginMax')).toBe(false);
    expect(params.has('categoryId')).toBe(false);
    expect(params.has('brandId')).toBe(false);
  });

  it('includes profitStatus=loss in the URL when profitStatus is "loss"', async () => {
    let capturedUrl = '';
    server.use(
      http.get(ENDPOINT, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(fixtureResponse([pricingRow({ profitStatus: 'loss' })]), {
          status: 200,
        });
      }),
    );

    const { result } = renderHook(
      () => useProductPricingList({ ...baseArgs, profitStatus: 'loss' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(new URL(capturedUrl).searchParams.get('profitStatus')).toBe('loss');
  });

  it('omits profitStatus from the URL when profitStatus is "all"', async () => {
    let capturedUrl = '';
    server.use(
      http.get(ENDPOINT, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(fixtureResponse([]), { status: 200 });
      }),
    );

    const { result } = renderHook(
      () => useProductPricingList({ ...baseArgs, profitStatus: 'all' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(new URL(capturedUrl).searchParams.has('profitStatus')).toBe(false);
  });
});
