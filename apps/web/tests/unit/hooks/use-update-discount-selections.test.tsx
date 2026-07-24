import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useUpdateDiscountSelections } from '@/features/campaigns/hooks/use-update-discount-selections';
import type { UpdateDiscountSelectionsBody } from '@/features/campaigns/api/update-discount-selections.api';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const LIST_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const ITEM_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const ENDPOINT = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/discount-lists/${LIST_ID}/selections`;

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

// Per-row 'set' mode: each { itemId, included } toggles one product's participation.
const SELECTIONS_BODY: UpdateDiscountSelectionsBody = {
  mode: 'set',
  selections: [
    { itemId: ITEM_ID, included: true },
    { itemId: '11111111-2222-3333-4444-555555555555', included: false },
  ],
};

describe('useUpdateDiscountSelections', () => {
  it('PATCHes the participation selections and resolves with the updated count', async () => {
    let capturedBody: unknown;
    server.use(
      http.patch(ENDPOINT, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ updated: 2 }, { status: 200 });
      }),
    );

    const { result } = renderHook(() => useUpdateDiscountSelections(ORG_ID, STORE_ID, LIST_ID), {
      wrapper: makeWrapper(createTestQueryClient()),
    });
    result.current.mutate(SELECTIONS_BODY);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedBody).toEqual(SELECTIONS_BODY);
    expect(result.current.data?.updated).toBe(2);
  });

  it('invalidates BOTH that list detail and the store list on success', async () => {
    server.use(http.patch(ENDPOINT, () => HttpResponse.json({ updated: 1 }, { status: 200 })));

    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateDiscountSelections(ORG_ID, STORE_ID, LIST_ID), {
      wrapper: makeWrapper(client),
    });
    result.current.mutate(SELECTIONS_BODY);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['discount-lists', 'detail', ORG_ID, STORE_ID, LIST_ID],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['discount-lists', 'list', ORG_ID, STORE_ID],
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
            detail: 'invalid selection',
            errors: [{ field: 'selections.0.itemId', code: 'invalid_type' }],
          },
          { status: 422, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    const { result } = renderHook(() => useUpdateDiscountSelections(ORG_ID, STORE_ID, LIST_ID), {
      wrapper: makeWrapper(createTestQueryClient()),
    });
    result.current.mutate(SELECTIONS_BODY);

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
