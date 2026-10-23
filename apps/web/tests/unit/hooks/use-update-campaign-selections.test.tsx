import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { UpdateCampaignSelectionsBody } from '@/features/campaigns/api/update-campaign-selections.api';
import { useUpdateCampaignSelections } from '@/features/campaigns/hooks/use-update-campaign-selections';
import { ApiError } from '@/lib/api-error';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const CAMPAIGN_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ENDPOINT = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/marketplace-campaigns/${CAMPAIGN_ID}/selections`;

/** The whole buffer, as "Kaydet ve İndir" sends it — a row on MAX may still carry a typed price. */
const BODY: UpdateCampaignSelectionsBody = {
  mode: 'set',
  selections: [
    { itemId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', selection: 'MAX', customPrice: '150.00' },
    { itemId: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee', selection: 'CUSTOM', customPrice: '120.00' },
    { itemId: 'cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee', selection: 'NONE', customPrice: null },
  ],
};

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('useUpdateCampaignSelections', () => {
  it('PATCHes the selections and invalidates the campaign detail and the store list', async () => {
    let received: unknown = null;
    server.use(
      http.patch(ENDPOINT, async ({ request }) => {
        received = await request.json();
        return HttpResponse.json({ updated: 3 });
      }),
    );

    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(
      () => useUpdateCampaignSelections(ORG_ID, STORE_ID, CAMPAIGN_ID),
      { wrapper: makeWrapper(client) },
    );
    result.current.mutate(BODY);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(received).toEqual(BODY);
    expect(result.current.data).toEqual({ updated: 3 });
    // The saved choices show on the detail; the list's selected count changes.
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['marketplace-campaigns', 'detail', ORG_ID, STORE_ID, CAMPAIGN_ID],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['marketplace-campaigns', 'list', ORG_ID, STORE_ID],
    });
  });

  it('surfaces a 422 CUSTOM_PRICE_ABOVE_MAX naming the offending item (and invalidates nothing)', async () => {
    const offending = 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee';
    server.use(
      http.patch(ENDPOINT, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Validation failed',
            status: 422,
            code: 'VALIDATION_ERROR',
            detail: 'custom price above the maximum',
            errors: [
              { field: 'selections', code: 'CUSTOM_PRICE_ABOVE_MAX', meta: { itemId: offending } },
            ],
          },
          { status: 422, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(
      () => useUpdateCampaignSelections(ORG_ID, STORE_ID, CAMPAIGN_ID),
      { wrapper: makeWrapper(client) },
    );
    result.current.mutate(BODY);

    await waitFor(() => expect(result.current.isError).toBe(true));
    const error = result.current.error;
    expect(error).toBeInstanceOf(ApiError);
    if (!(error instanceof ApiError)) return;
    expect(error.problem.errors?.[0]).toEqual({
      field: 'selections',
      code: 'CUSTOM_PRICE_ABOVE_MAX',
      meta: { itemId: offending },
    });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
