import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useEstimateFlashItemPrice } from '@/features/campaigns/hooks/use-estimate-flash-item-price';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const LIST_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ITEM_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const ENDPOINT = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/flash-products/${LIST_ID}/items/${ITEM_ID}/estimate`;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

const CALCULABLE_BREAKDOWN = {
  listGross: '800.00',
  sellerDiscountGross: '0.00',
  saleGross: '500.00',
  saleVat: '76.92',
  costGross: '300.00',
  costVat: '46.15',
  commissionGross: '65.50',
  commissionVat: '10.08',
  shippingGross: '35.00',
  shippingVat: '5.38',
  platformServiceGross: '0.00',
  platformServiceVat: '0.00',
  stoppage: '5.00',
  netVat: '9.86',
  netProfit: '90.00',
  saleMarginPct: '18.00',
  costMarkupPct: '50.00',
};

describe('useEstimateFlashItemPrice', () => {
  it('resolves with the full breakdown when calculable=true (custom-price what-if)', async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json(
          {
            itemId: ITEM_ID,
            price: '500.00',
            commissionPct: '13.10',
            commissionSource: 'band',
            calculable: true,
            reason: null,
            breakdown: CALCULABLE_BREAKDOWN,
          },
          { status: 200 },
        ),
      ),
    );

    const { result } = renderHook(() => useEstimateFlashItemPrice(ORG_ID, STORE_ID, LIST_ID), {
      wrapper,
    });
    result.current.mutate({ itemId: ITEM_ID, body: { price: '500.00' } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.calculable).toBe(true);
    expect(result.current.data?.commissionSource).toBe('band');
    expect(result.current.data?.breakdown?.netProfit).toBe('90.00');
    expect(result.current.data?.breakdown?.saleMarginPct).toBe('18.00');
  });

  it('sends the typed price in the request body (custom-price what-if)', async () => {
    let capturedBody: unknown;
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(
          {
            itemId: ITEM_ID,
            price: '450.00',
            commissionPct: '13.10',
            commissionSource: 'band',
            calculable: true,
            reason: null,
            breakdown: CALCULABLE_BREAKDOWN,
          },
          { status: 200 },
        );
      }),
    );

    const { result } = renderHook(() => useEstimateFlashItemPrice(ORG_ID, STORE_ID, LIST_ID), {
      wrapper,
    });
    result.current.mutate({ itemId: ITEM_ID, body: { price: '450.00' } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedBody).toEqual({ price: '450.00' });
  });

  it("sends scenario:'current' (no price) for the current-baseline breakdown", async () => {
    let capturedBody: unknown;
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(
          {
            itemId: ITEM_ID,
            price: '800.00',
            commissionPct: '19.00',
            commissionSource: 'current',
            calculable: true,
            reason: null,
            breakdown: { ...CALCULABLE_BREAKDOWN, netProfit: '50.00', saleMarginPct: '6.25' },
          },
          { status: 200 },
        );
      }),
    );

    const { result } = renderHook(() => useEstimateFlashItemPrice(ORG_ID, STORE_ID, LIST_ID), {
      wrapper,
    });
    result.current.mutate({ itemId: ITEM_ID, body: { scenario: 'current' } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // The current scenario carries no price — the backend derives the customer price + its
    // commission from the item itself.
    expect(capturedBody).toEqual({ scenario: 'current' });
    expect(result.current.data?.commissionSource).toBe('current');
    expect(result.current.data?.breakdown?.netProfit).toBe('50.00');
  });

  it('resolves (does NOT error) when calculable=false — breakdown is null with a reason', async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json(
          {
            itemId: ITEM_ID,
            price: '500.00',
            commissionPct: null,
            commissionSource: null,
            calculable: false,
            reason: 'NO_COST',
            breakdown: null,
          },
          { status: 200 },
        ),
      ),
    );

    const { result } = renderHook(() => useEstimateFlashItemPrice(ORG_ID, STORE_ID, LIST_ID), {
      wrapper,
    });
    result.current.mutate({ itemId: ITEM_ID, body: { price: '500.00' } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.calculable).toBe(false);
    expect(result.current.data?.reason).toBe('NO_COST');
    expect(result.current.data?.breakdown).toBeNull();
    expect(result.current.isError).toBe(false);
  });
});
