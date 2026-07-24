import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useEstimateDiscountItem } from '@/features/campaigns/hooks/use-estimate-discount-item';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const LIST_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const ITEM_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const ENDPOINT = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/discount-lists/${LIST_ID}/items/${ITEM_ID}/estimate`;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

const DISCOUNTED_BREAKDOWN = {
  listGross: '100.00',
  sellerDiscountGross: '20.00',
  saleGross: '80.00',
  saleVat: '12.31',
  costGross: '40.00',
  costVat: '6.15',
  commissionGross: '18.90',
  commissionVat: '2.91',
  shippingGross: '15.00',
  shippingVat: '2.31',
  platformServiceGross: '0.00',
  platformServiceVat: '0.00',
  stoppage: '0.80',
  netVat: '1.61',
  netProfit: '10.00',
  saleMarginPct: '12.50',
  costMarkupPct: '25.00',
  marketplaceFeesGross: '33.90',
  taxesGross: '2.41',
  totalDeductionsGross: '70.00',
};

describe('useEstimateDiscountItem', () => {
  it('resolves with the full breakdown when calculable=true (discounted scenario)', async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json(
          {
            itemId: ITEM_ID,
            scenario: 'discounted',
            price: '80.00',
            commissionPct: '23.63',
            commissionSource: 'band',
            calculable: true,
            reason: null,
            breakdown: DISCOUNTED_BREAKDOWN,
          },
          { status: 200 },
        ),
      ),
    );

    const { result } = renderHook(() => useEstimateDiscountItem(ORG_ID, STORE_ID, LIST_ID), {
      wrapper,
    });
    result.current.mutate({ itemId: ITEM_ID, body: { scenario: 'discounted' } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.calculable).toBe(true);
    expect(result.current.data?.commissionSource).toBe('band');
    expect(result.current.data?.breakdown?.netProfit).toBe('10.00');
    expect(result.current.data?.breakdown?.saleMarginPct).toBe('12.50');
  });

  it('sends the chosen scenario in the request body', async () => {
    let capturedBody: unknown;
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(
          {
            itemId: ITEM_ID,
            scenario: 'current',
            price: '100.00',
            commissionPct: '23.63',
            commissionSource: 'band',
            calculable: true,
            reason: null,
            breakdown: { ...DISCOUNTED_BREAKDOWN, netProfit: '25.00' },
          },
          { status: 200 },
        );
      }),
    );

    const { result } = renderHook(() => useEstimateDiscountItem(ORG_ID, STORE_ID, LIST_ID), {
      wrapper,
    });
    result.current.mutate({ itemId: ITEM_ID, body: { scenario: 'current' } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedBody).toEqual({ scenario: 'current' });
    expect(result.current.data?.breakdown?.netProfit).toBe('25.00');
  });

  it('resolves (does NOT error) when calculable=false — breakdown is null with a reason', async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json(
          {
            itemId: ITEM_ID,
            scenario: 'discounted',
            price: '80.00',
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

    const { result } = renderHook(() => useEstimateDiscountItem(ORG_ID, STORE_ID, LIST_ID), {
      wrapper,
    });
    result.current.mutate({ itemId: ITEM_ID, body: { scenario: 'discounted' } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.calculable).toBe(false);
    expect(result.current.data?.reason).toBe('NO_COST');
    expect(result.current.data?.breakdown).toBeNull();
    expect(result.current.isError).toBe(false);
  });
});
