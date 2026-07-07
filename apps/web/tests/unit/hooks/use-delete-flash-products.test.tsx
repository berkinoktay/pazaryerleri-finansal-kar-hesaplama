import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useDeleteFlashProducts } from '@/features/campaigns/hooks/use-delete-flash-products';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const LIST_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ENDPOINT = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/flash-products/${LIST_ID}`;

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('useDeleteFlashProducts', () => {
  it('resolves on 204 and invalidates the store Flash Products list', async () => {
    server.use(http.delete(ENDPOINT, () => new HttpResponse(null, { status: 204 })));

    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useDeleteFlashProducts(ORG_ID, STORE_ID), {
      wrapper: makeWrapper(client),
    });
    result.current.mutate(LIST_ID);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['flash-products', 'list', ORG_ID, STORE_ID],
    });
  });

  it('throws an ApiError on a 404 (and does not invalidate)', async () => {
    server.use(
      http.delete(ENDPOINT, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Not found',
            status: 404,
            code: 'NOT_FOUND',
            detail: 'list missing',
          },
          { status: 404, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useDeleteFlashProducts(ORG_ID, STORE_ID), {
      wrapper: makeWrapper(client),
    });
    result.current.mutate(LIST_ID);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
