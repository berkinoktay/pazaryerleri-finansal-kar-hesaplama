import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useCommissionRates } from '@/features/commission-rates/hooks/use-commission-rates';
import { ApiError } from '@/lib/api-error';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const ENDPOINT = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/commission-rates`;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

const baseArgs = {
  orgId: ORG_ID,
  storeId: STORE_ID,
  ruleKind: 'CATEGORY' as const,
  productScope: 'all' as const,
  sort: 'category_name:asc' as const,
  page: 1,
  perPage: 50,
};

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'r-1',
    ruleKind: 'CATEGORY',
    platform: 'TRENDYOL',
    categoryId: '411',
    brandId: null,
    categoryName: 'Casual Ayakkabı',
    parentCategoryName: 'Günlük Ayakkabı',
    brandName: null,
    baseRate: '5.00',
    paymentTermDays: 14,
    segmentOverrides: {},
    productCount: 0,
    fetchedAt: '2026-05-12T08:23:01.000Z',
    ...overrides,
  };
}

function fixtureResponse(
  rows: ReturnType<typeof row>[],
  pagination: Partial<{ page: number; perPage: number; total: number; totalPages: number }> = {},
) {
  return {
    data: rows,
    pagination: { page: 1, perPage: 50, total: rows.length, totalPages: 1, ...pagination },
  };
}

describe('useCommissionRates', () => {
  it('fetches page 1 by default with the page + perPage query params', async () => {
    let capturedUrl = '';
    server.use(
      http.get(ENDPOINT, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(fixtureResponse([row()]), { status: 200 });
      }),
    );

    const { result } = renderHook(() => useCommissionRates(baseArgs), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data).toHaveLength(1);
    expect(result.current.data?.pagination.page).toBe(1);
    expect(capturedUrl).toContain('ruleKind=CATEGORY');
    expect(capturedUrl).toContain('productScope=all');
    expect(capturedUrl).toContain('sort=category_name%3Aasc');
    expect(capturedUrl).toContain('page=1');
    expect(capturedUrl).toContain('perPage=50');
    expect(capturedUrl).not.toContain('cursor=');
  });

  it('does not fire when args is null (enabled=false)', () => {
    const { result } = renderHook(() => useCommissionRates(null), { wrapper });
    expect(result.current.isFetching).toBe(false);
    expect(result.current.status).toBe('pending');
  });

  it('forwards page=2 to the request when the caller increments page', async () => {
    let capturedUrl = '';
    server.use(
      http.get(ENDPOINT, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(
          fixtureResponse([row({ id: 'r-2' })], { page: 2, total: 60, totalPages: 2 }),
          { status: 200 },
        );
      }),
    );

    const { result } = renderHook(() => useCommissionRates({ ...baseArgs, page: 2 }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedUrl).toContain('page=2');
    expect(result.current.data?.pagination.page).toBe(2);
    expect(result.current.data?.pagination.totalPages).toBe(2);
  });

  it('surfaces an ApiError on 422 INVALID_SORT_FOR_SCOPE', async () => {
    server.use(
      http.get(ENDPOINT, () =>
        HttpResponse.json(
          {
            type: 'https://api.pazarsync.com/errors/invalid-sort-for-scope',
            title: 'Invalid sort for scope',
            status: 422,
            code: 'INVALID_SORT_FOR_SCOPE',
            detail: 'product_count:desc requires productScope=active',
          },
          { status: 422 },
        ),
      ),
    );

    const { result } = renderHook(
      () => useCommissionRates({ ...baseArgs, sort: 'product_count:desc' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect((result.current.error as ApiError).code).toBe('INVALID_SORT_FOR_SCOPE');
  });
});
