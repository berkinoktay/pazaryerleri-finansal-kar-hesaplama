import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useUpdateDiscountList } from '@/features/campaigns/hooks/use-update-discount-list';
import type { UpdateDiscountListBody } from '@/features/campaigns/api/update-discount-list.api';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const LIST_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const ENDPOINT = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/discount-lists/${LIST_ID}`;

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

// Full-replace of the list's discount configuration (a NET percentage discount + a new name).
const UPDATE_BODY: UpdateDiscountListBody = {
  discountType: 'NET',
  valueKind: 'PERCENT',
  value: '15',
  name: 'Yaz İndirimi',
};

describe('useUpdateDiscountList', () => {
  it('PATCHes the discount configuration and resolves with the list id', async () => {
    let capturedBody: unknown;
    server.use(
      http.patch(ENDPOINT, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ id: LIST_ID }, { status: 200 });
      }),
    );

    const { result } = renderHook(() => useUpdateDiscountList(ORG_ID, STORE_ID, LIST_ID), {
      wrapper: makeWrapper(createTestQueryClient()),
    });
    result.current.mutate(UPDATE_BODY);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedBody).toEqual(UPDATE_BODY);
    expect(result.current.data?.id).toBe(LIST_ID);
  });

  it('invalidates BOTH that list detail and the store list on success', async () => {
    server.use(http.patch(ENDPOINT, () => HttpResponse.json({ id: LIST_ID }, { status: 200 })));

    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateDiscountList(ORG_ID, STORE_ID, LIST_ID), {
      wrapper: makeWrapper(client),
    });
    result.current.mutate(UPDATE_BODY);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['discount-lists', 'detail', ORG_ID, STORE_ID, LIST_ID],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['discount-lists', 'list', ORG_ID, STORE_ID],
    });
  });

  it('throws an ApiError on a 422 validation failure (config Trendyol would reject)', async () => {
    server.use(
      http.patch(ENDPOINT, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Validation error',
            status: 422,
            code: 'VALIDATION_ERROR',
            detail: 'fixed price only for Nth',
            errors: [{ field: 'valueKind', code: 'FIXED_PRICE_ONLY_FOR_NTH' }],
          },
          { status: 422, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    const { result } = renderHook(() => useUpdateDiscountList(ORG_ID, STORE_ID, LIST_ID), {
      wrapper: makeWrapper(createTestQueryClient()),
    });
    result.current.mutate(UPDATE_BODY);

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
