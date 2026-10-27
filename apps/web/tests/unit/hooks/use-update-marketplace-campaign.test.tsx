import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { UpdateMarketplaceCampaignBody } from '@/features/campaigns/api/update-marketplace-campaign.api';
import { useUpdateMarketplaceCampaign } from '@/features/campaigns/hooks/use-update-marketplace-campaign';
import { ApiError } from '@/lib/api-error';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const CAMPAIGN_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ENDPOINT = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/marketplace-campaigns/${CAMPAIGN_ID}`;

/** The FULL config a save sends — the PATCH replaces, so the funding rate travels explicitly. */
const BODY: UpdateMarketplaceCampaignBody = {
  discountType: 'BUY_X_PAY_Y',
  buyQuantity: '3',
  payQuantity: '2',
  trendyolFundingPct: '60',
  startsAt: '2026-08-01T07:00:00.000Z',
  endsAt: '2026-08-07T20:59:00.000Z',
  name: 'Ağustos Kampanyası',
};

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('useUpdateMarketplaceCampaign', () => {
  it('PATCHes the whole config and invalidates the campaign detail and the store list', async () => {
    let received: unknown = null;
    server.use(
      http.patch(ENDPOINT, async ({ request }) => {
        received = await request.json();
        return HttpResponse.json({ id: CAMPAIGN_ID });
      }),
    );

    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(
      () => useUpdateMarketplaceCampaign(ORG_ID, STORE_ID, CAMPAIGN_ID),
      { wrapper: makeWrapper(client) },
    );
    result.current.mutate(BODY);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(received).toEqual(BODY);
    expect(result.current.data).toEqual({ id: CAMPAIGN_ID });
    // Every row's scenario recomputes from the new config on the next detail read.
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['marketplace-campaigns', 'detail', ORG_ID, STORE_ID, CAMPAIGN_ID],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['marketplace-campaigns', 'list', ORG_ID, STORE_ID],
    });
  });

  it('surfaces a 422 VALIDATION_ERROR with its field issues (and invalidates nothing)', async () => {
    server.use(
      http.patch(ENDPOINT, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Validation failed',
            status: 422,
            code: 'VALIDATION_ERROR',
            detail: 'invalid config',
            errors: [{ field: 'trendyolFundingPct', code: 'FUNDING_PCT_OVER_100' }],
          },
          { status: 422, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(
      () => useUpdateMarketplaceCampaign(ORG_ID, STORE_ID, CAMPAIGN_ID),
      { wrapper: makeWrapper(client) },
    );
    result.current.mutate({ ...BODY, trendyolFundingPct: '150' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    const error = result.current.error;
    expect(error).toBeInstanceOf(ApiError);
    if (!(error instanceof ApiError)) return;
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.problem.errors).toEqual([
      { field: 'trendyolFundingPct', code: 'FUNDING_PCT_OVER_100' },
    ]);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
