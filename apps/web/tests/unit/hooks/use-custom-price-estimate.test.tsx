import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useCustomPriceEstimate } from '@/features/campaigns/hooks/use-custom-price-estimate';
import { marketplaceCampaignKeys } from '@/features/campaigns/query-keys';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const CAMPAIGN_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ITEM_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const ENDPOINT = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/marketplace-campaigns/${CAMPAIGN_ID}/items/${ITEM_ID}/estimate`;

const RESULT = {
  itemId: ITEM_ID,
  scenario: 'custom',
  price: '150.00',
  customerPaidUnitPrice: '150.00',
  trendyolFundedUnitAmount: '0.00',
  commissionPct: '18.0000',
  commissionSource: 'product',
  calculable: true,
  reason: null,
  breakdown: null,
  breakdownScope: 'unit',
  basket: null,
  commissionTariffName: null,
  commissionPeriodLabel: null,
};

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('useCustomPriceEstimate', () => {
  it('prices the given custom price and caches it under the campaign detail', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(RESULT);
      }),
    );

    const client = createTestQueryClient();
    const { result } = renderHook(
      () => useCustomPriceEstimate(ORG_ID, STORE_ID, CAMPAIGN_ID, ITEM_ID, '150.00'),
      { wrapper: makeWrapper(client) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(bodies).toEqual([{ scenario: 'custom', customPrice: '150.00' }]);
    expect(result.current.data?.price).toBe('150.00');
    // Nested under the detail key: invalidating the detail (a config edit, a selections save)
    // re-prices the what-ifs as well.
    const key = marketplaceCampaignKeys.customEstimate(
      ORG_ID,
      STORE_ID,
      CAMPAIGN_ID,
      ITEM_ID,
      '150.00',
    );
    expect(
      key.slice(0, marketplaceCampaignKeys.detail(ORG_ID, STORE_ID, CAMPAIGN_ID).length),
    ).toEqual([...marketplaceCampaignKeys.detail(ORG_ID, STORE_ID, CAMPAIGN_ID)]);
    expect(client.getQueryData(key)).toEqual(RESULT);
  });

  it('sends nothing while there is no price to estimate', async () => {
    let calls = 0;
    server.use(
      http.post(ENDPOINT, () => {
        calls += 1;
        return HttpResponse.json(RESULT);
      }),
    );

    const { result } = renderHook(
      () => useCustomPriceEstimate(ORG_ID, STORE_ID, CAMPAIGN_ID, ITEM_ID, null),
      { wrapper: makeWrapper(createTestQueryClient()) },
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current.fetchStatus).toBe('idle');
    expect(calls).toBe(0);
  });
});
