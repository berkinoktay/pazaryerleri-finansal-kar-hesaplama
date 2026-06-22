import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useQuoteProductPricing } from '@/features/product-pricing/hooks/use-quote-product-pricing';

import { createTestQueryClient } from '../../helpers/render';
import { server, http, HttpResponse } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const VARIANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const ENDPOINT = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/product-pricing/quote`;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

const QUOTE_INPUT = {
  variantId: VARIANT_ID,
  target: { type: 'margin' as const, value: '20' },
};

const CALCULABLE_BREAKDOWN = {
  listGross: '1000.00',
  sellerDiscountGross: '0.00',
  saleGross: '1000.00',
  saleVat: '153.90',
  costGross: '600.00',
  costVat: '92.34',
  commissionGross: '150.00',
  commissionVat: '23.09',
  shippingGross: '40.00',
  shippingVat: '6.15',
  platformServiceGross: '0.00',
  platformServiceVat: '0.00',
  stoppage: '10.00',
  netVat: '32.32',
  netProfit: '200.00',
  saleMarginPct: '20.00',
  costMarkupPct: '33.33',
};

describe('useQuoteProductPricing', () => {
  it('resolves with the full quote when calculable=true', async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json(
          {
            variantId: VARIANT_ID,
            calculable: true,
            price: '1000.00',
            breakdown: CALCULABLE_BREAKDOWN,
          },
          { status: 200 },
        ),
      ),
    );

    const { result } = renderHook(() => useQuoteProductPricing(ORG_ID, STORE_ID), { wrapper });
    result.current.mutate(QUOTE_INPUT);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const data = result.current.data;
    expect(data?.calculable).toBe(true);
    expect(data?.price).toBe('1000.00');
    expect(data?.breakdown?.netProfit).toBe('200.00');
    expect(data?.breakdown?.saleMarginPct).toBe('20.00');
  });

  it('resolves (does NOT throw) when calculable=false — the reason is returned as data', async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json(
          {
            variantId: VARIANT_ID,
            calculable: false,
            reason: 'NO_COST',
          },
          { status: 200 },
        ),
      ),
    );

    const { result } = renderHook(() => useQuoteProductPricing(ORG_ID, STORE_ID), { wrapper });
    result.current.mutate(QUOTE_INPUT);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const data = result.current.data;
    expect(data?.calculable).toBe(false);
    expect(data?.reason).toBe('NO_COST');
    expect(data?.price).toBeUndefined();
    expect(data?.breakdown).toBeUndefined();
    // Confirm it did NOT enter an error state
    expect(result.current.isError).toBe(false);
  });

  it('sends the correct variantId and target in the request body', async () => {
    let capturedBody: unknown;
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(
          {
            variantId: VARIANT_ID,
            calculable: false,
            reason: 'UNREACHABLE_TARGET',
          },
          { status: 200 },
        );
      }),
    );

    const markupInput = {
      variantId: VARIANT_ID,
      target: { type: 'markup' as const, value: '35.50' },
    };

    const { result } = renderHook(() => useQuoteProductPricing(ORG_ID, STORE_ID), { wrapper });
    result.current.mutate(markupInput);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedBody).toEqual({
      variantId: VARIANT_ID,
      target: { type: 'markup', value: '35.50' },
    });
  });
});
