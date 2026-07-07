import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useUpdateFlashSelections } from '@/features/campaigns/hooks/use-update-flash-selections';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const LIST_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ITEM_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const ENDPOINT = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/flash-products/${LIST_ID}/selections`;

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

// One row joined at a flash offer, one row joined at a custom price — the two mutually
// exclusive XOR shapes the PATCH must round-trip (offer → customPrice null; custom → offer
// null with a price).
const SELECTIONS_BODY = {
  selections: [
    { itemId: ITEM_ID, offer: 'H24' as const, customPrice: null },
    {
      itemId: '11111111-2222-3333-4444-555555555555',
      offer: null,
      customPrice: '499.90',
    },
  ],
};

describe('useUpdateFlashSelections', () => {
  it('PATCHes the offer/custom XOR selections and resolves with the updated count', async () => {
    let capturedBody: unknown;
    server.use(
      http.patch(ENDPOINT, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ updated: 2 }, { status: 200 });
      }),
    );

    const { result } = renderHook(() => useUpdateFlashSelections(ORG_ID, STORE_ID, LIST_ID), {
      wrapper: makeWrapper(createTestQueryClient()),
    });
    result.current.mutate(SELECTIONS_BODY);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedBody).toEqual(SELECTIONS_BODY);
    expect(result.current.data?.updated).toBe(2);
  });

  it('invalidates that list detail on success', async () => {
    server.use(http.patch(ENDPOINT, () => HttpResponse.json({ updated: 1 }, { status: 200 })));

    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateFlashSelections(ORG_ID, STORE_ID, LIST_ID), {
      wrapper: makeWrapper(client),
    });
    result.current.mutate(SELECTIONS_BODY);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['flash-products', 'detail', ORG_ID, STORE_ID, LIST_ID],
    });
  });

  it('throws an ApiError on a 422 validation failure', async () => {
    server.use(
      http.patch(ENDPOINT, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Validation error',
            status: 422,
            code: 'VALIDATION_ERROR',
            detail: 'invalid custom price',
            errors: [{ field: 'selections.1.customPrice', code: 'invalid_type' }],
          },
          { status: 422, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    const { result } = renderHook(() => useUpdateFlashSelections(ORG_ID, STORE_ID, LIST_ID), {
      wrapper: makeWrapper(createTestQueryClient()),
    });
    result.current.mutate(SELECTIONS_BODY);

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
