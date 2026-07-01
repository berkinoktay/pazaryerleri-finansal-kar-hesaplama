import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useUpdateSelections } from '@/features/campaigns/hooks/use-update-selections';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const TARIFF_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ITEM_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const ENDPOINT = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/commission-tariffs/${TARIFF_ID}/selections`;

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

const SELECTIONS_BODY = {
  selections: [
    { itemId: ITEM_ID, band: 'band2' as const, customPrice: null },
    { itemId: '11111111-2222-3333-4444-555555555555', band: null, customPrice: '399.90' },
  ],
};

describe('useUpdateSelections', () => {
  it('PATCHes the selections and resolves with the updated count', async () => {
    let capturedBody: unknown;
    server.use(
      http.patch(ENDPOINT, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ updated: 2 }, { status: 200 });
      }),
    );

    const { result } = renderHook(() => useUpdateSelections(ORG_ID, STORE_ID, TARIFF_ID), {
      wrapper: makeWrapper(createTestQueryClient()),
    });
    result.current.mutate(SELECTIONS_BODY);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedBody).toEqual(SELECTIONS_BODY);
    expect(result.current.data?.updated).toBe(2);
  });

  it('invalidates that tariff detail on success', async () => {
    server.use(http.patch(ENDPOINT, () => HttpResponse.json({ updated: 1 }, { status: 200 })));

    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateSelections(ORG_ID, STORE_ID, TARIFF_ID), {
      wrapper: makeWrapper(client),
    });
    result.current.mutate(SELECTIONS_BODY);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['commission-tariffs', 'detail', ORG_ID, STORE_ID, TARIFF_ID],
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
            detail: 'invalid band',
            errors: [{ field: 'selections.0.band', code: 'invalid_enum_value' }],
          },
          { status: 422, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    const { result } = renderHook(() => useUpdateSelections(ORG_ID, STORE_ID, TARIFF_ID), {
      wrapper: makeWrapper(createTestQueryClient()),
    });
    result.current.mutate(SELECTIONS_BODY);

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
