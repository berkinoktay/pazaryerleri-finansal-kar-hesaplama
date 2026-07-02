import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useEstimatePlusItemPrice } from '@/features/campaigns/hooks/use-estimate-plus-item-price';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const TARIFF_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ITEM_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const ENDPOINT = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/plus-commission-tariffs/${TARIFF_ID}/items/${ITEM_ID}/estimate`;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

const CALCULABLE_BREAKDOWN = {
  listGross: '450.00',
  sellerDiscountGross: '0.00',
  saleGross: '450.00',
  saleVat: '69.25',
  costGross: '300.00',
  costVat: '46.17',
  commissionGross: '81.00',
  commissionVat: '12.46',
  shippingGross: '30.00',
  shippingVat: '4.62',
  platformServiceGross: '0.00',
  platformServiceVat: '0.00',
  stoppage: '5.00',
  netVat: '5.99',
  netProfit: '34.00',
  saleMarginPct: '7.56',
  costMarkupPct: '11.33',
};

describe('useEstimatePlusItemPrice', () => {
  it('resolves with the full breakdown when calculable=true', async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json(
          {
            itemId: ITEM_ID,
            price: '450.00',
            commissionPct: '14.00',
            calculable: true,
            reason: null,
            breakdown: CALCULABLE_BREAKDOWN,
          },
          { status: 200 },
        ),
      ),
    );

    const { result } = renderHook(() => useEstimatePlusItemPrice(ORG_ID, STORE_ID, TARIFF_ID), {
      wrapper,
    });
    result.current.mutate({ itemId: ITEM_ID, body: { price: '450.00' } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.calculable).toBe(true);
    expect(result.current.data?.breakdown?.netProfit).toBe('34.00');
    expect(result.current.data?.breakdown?.saleMarginPct).toBe('7.56');
  });

  it('resolves (does NOT error) when calculable=false — breakdown is null with a reason', async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json(
          {
            itemId: ITEM_ID,
            price: '450.00',
            commissionPct: null,
            calculable: false,
            reason: 'NO_COST',
            breakdown: null,
          },
          { status: 200 },
        ),
      ),
    );

    const { result } = renderHook(() => useEstimatePlusItemPrice(ORG_ID, STORE_ID, TARIFF_ID), {
      wrapper,
    });
    result.current.mutate({ itemId: ITEM_ID, body: { price: '450.00' } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.calculable).toBe(false);
    expect(result.current.data?.reason).toBe('NO_COST');
    expect(result.current.data?.breakdown).toBeNull();
    expect(result.current.isError).toBe(false);
  });

  it('sends the typed price + scenario in the request body (scenario what-if mode)', async () => {
    let capturedBody: unknown;
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(
          {
            itemId: ITEM_ID,
            price: '400.00',
            commissionPct: '20.00',
            calculable: true,
            reason: null,
            breakdown: CALCULABLE_BREAKDOWN,
          },
          { status: 200 },
        );
      }),
    );

    const { result } = renderHook(() => useEstimatePlusItemPrice(ORG_ID, STORE_ID, TARIFF_ID), {
      wrapper,
    });
    result.current.mutate({ itemId: ITEM_ID, body: { price: '400.00', scenario: 'current' } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedBody).toEqual({ price: '400.00', scenario: 'current' });
  });
});
