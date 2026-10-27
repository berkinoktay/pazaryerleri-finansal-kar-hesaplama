import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useEstimateCampaignItem } from '@/features/campaigns/hooks/use-estimate-campaign-item';
import { ApiError } from '@/lib/api-error';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const CAMPAIGN_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ITEM_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const ENDPOINT = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/marketplace-campaigns/${CAMPAIGN_ID}/items/${ITEM_ID}/estimate`;

/** An order-scoped answer for a typed custom price: the basket block rides along. */
const RESULT = {
  itemId: ITEM_ID,
  scenario: 'custom',
  price: '450.00',
  customerPaidUnitPrice: null,
  trendyolFundedUnitAmount: null,
  commissionPct: '18.0000',
  commissionSource: 'product',
  calculable: true,
  reason: null,
  breakdown: null,
  breakdownScope: 'order',
  basket: {
    assumedQuantity: 3,
    basketTotal: '450.00',
    basketPaidTotal: '300.00',
    basketDiscountTotal: '150.00',
    trendyolFundedTotal: '0.00',
    orderNetProfit: '28.00',
    orderMarginPct: '6.22',
    currentOrderNetProfit: '90.00',
  },
  commissionTariffName: null,
  commissionPeriodLabel: null,
};

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('useEstimateCampaignItem', () => {
  it('POSTs the scenario + the buffered price to the item and returns the breakdown, writing nothing', async () => {
    let received: unknown = null;
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        received = await request.json();
        return HttpResponse.json(RESULT);
      }),
    );

    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useEstimateCampaignItem(ORG_ID, STORE_ID, CAMPAIGN_ID), {
      wrapper: makeWrapper(client),
    });
    result.current.mutate({
      itemId: ITEM_ID,
      body: { scenario: 'custom', customPrice: '150.00' },
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(received).toEqual({ scenario: 'custom', customPrice: '150.00' });
    expect(result.current.data?.breakdownScope).toBe('order');
    expect(result.current.data?.basket?.assumedQuantity).toBe(3);
    // A pure compute: nothing is cached or invalidated.
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('surfaces a 422 CUSTOM_PRICE_ABOVE_MAX as an ApiError', async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Validation failed',
            status: 422,
            code: 'VALIDATION_ERROR',
            detail: 'custom price above the maximum',
            errors: [
              {
                field: 'customPrice',
                code: 'CUSTOM_PRICE_ABOVE_MAX',
                meta: { maxPrice: '200.00' },
              },
            ],
          },
          { status: 422, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    const { result } = renderHook(() => useEstimateCampaignItem(ORG_ID, STORE_ID, CAMPAIGN_ID), {
      wrapper: makeWrapper(createTestQueryClient()),
    });
    result.current.mutate({
      itemId: ITEM_ID,
      body: { scenario: 'custom', customPrice: '250.00' },
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    const error = result.current.error;
    expect(error).toBeInstanceOf(ApiError);
    if (!(error instanceof ApiError)) return;
    expect(error.problem.errors?.[0]?.code).toBe('CUSTOM_PRICE_ABOVE_MAX');
  });
});
