import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useEstimateAdvantageItemPrice } from '@/features/campaigns/hooks/use-estimate-advantage-item-price';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const TARIFF_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ITEM_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const ENDPOINT = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/advantage-tariffs/${TARIFF_ID}/items/${ITEM_ID}/estimate`;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

const CALCULABLE_BREAKDOWN = {
  listGross: '150.00',
  sellerDiscountGross: '0.00',
  saleGross: '120.00',
  saleVat: '18.46',
  costGross: '80.00',
  costVat: '12.31',
  commissionGross: '16.80',
  commissionVat: '2.58',
  shippingGross: '20.00',
  shippingVat: '3.08',
  platformServiceGross: '0.00',
  platformServiceVat: '0.00',
  stoppage: '3.00',
  netVat: '2.61',
  netProfit: '40.00',
  saleMarginPct: '33.33',
  costMarkupPct: '50.00',
};

describe('useEstimateAdvantageItemPrice', () => {
  it('resolves with the full breakdown when calculable=true (price what-if)', async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json(
          {
            itemId: ITEM_ID,
            price: '120.00',
            commissionPct: '14.00',
            commissionSource: 'band',
            calculable: true,
            reason: null,
            breakdown: CALCULABLE_BREAKDOWN,
          },
          { status: 200 },
        ),
      ),
    );

    const { result } = renderHook(
      () => useEstimateAdvantageItemPrice(ORG_ID, STORE_ID, TARIFF_ID),
      { wrapper },
    );
    result.current.mutate({ itemId: ITEM_ID, body: { price: '120.00' } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.calculable).toBe(true);
    expect(result.current.data?.commissionSource).toBe('band');
    expect(result.current.data?.breakdown?.netProfit).toBe('40.00');
    expect(result.current.data?.breakdown?.saleMarginPct).toBe('33.33');
  });

  it('sends the typed price in the request body (custom-price what-if)', async () => {
    let capturedBody: unknown;
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(
          {
            itemId: ITEM_ID,
            price: '99.90',
            commissionPct: '15.40',
            commissionSource: 'band',
            calculable: true,
            reason: null,
            breakdown: CALCULABLE_BREAKDOWN,
          },
          { status: 200 },
        );
      }),
    );

    const { result } = renderHook(
      () => useEstimateAdvantageItemPrice(ORG_ID, STORE_ID, TARIFF_ID),
      { wrapper },
    );
    result.current.mutate({ itemId: ITEM_ID, body: { price: '99.90' } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedBody).toEqual({ price: '99.90' });
  });

  it("sends scenario:'current' (no price) for the current-baseline breakdown", async () => {
    let capturedBody: unknown;
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(
          {
            itemId: ITEM_ID,
            price: '120.00',
            commissionPct: '19.00',
            commissionSource: 'category',
            calculable: true,
            reason: null,
            breakdown: { ...CALCULABLE_BREAKDOWN, netProfit: '10.00', saleMarginPct: '8.00' },
          },
          { status: 200 },
        );
      }),
    );

    const { result } = renderHook(
      () => useEstimateAdvantageItemPrice(ORG_ID, STORE_ID, TARIFF_ID),
      { wrapper },
    );
    result.current.mutate({ itemId: ITEM_ID, body: { scenario: 'current' } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // The current scenario carries no price — the backend derives the customer price + its
    // commission from the item itself.
    expect(capturedBody).toEqual({ scenario: 'current' });
    expect(result.current.data?.breakdown?.netProfit).toBe('10.00');
  });

  it('resolves (does NOT error) when calculable=false — breakdown is null with a reason', async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json(
          {
            itemId: ITEM_ID,
            price: '120.00',
            commissionPct: null,
            commissionSource: null,
            calculable: false,
            reason: 'NO_COMMISSION',
            breakdown: null,
          },
          { status: 200 },
        ),
      ),
    );

    const { result } = renderHook(
      () => useEstimateAdvantageItemPrice(ORG_ID, STORE_ID, TARIFF_ID),
      { wrapper },
    );
    result.current.mutate({ itemId: ITEM_ID, body: { price: '120.00' } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.calculable).toBe(false);
    expect(result.current.data?.reason).toBe('NO_COMMISSION');
    expect(result.current.data?.breakdown).toBeNull();
    expect(result.current.isError).toBe(false);
  });
});
