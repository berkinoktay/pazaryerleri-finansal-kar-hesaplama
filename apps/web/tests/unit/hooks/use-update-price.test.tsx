import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUpdatePrice } from '@/features/product-pricing/hooks/use-update-price';

import trMessages from '../../../messages/tr.json';
import { createTestQueryClient } from '../../helpers/render';
import { server, http, HttpResponse } from '../../helpers/msw';

// ─── Sonner mock ─────────────────────────────────────────────────────────────
// The hook fires an outcome-specific success toast (SUCCESS vs PENDING). Mock
// sonner so we can assert on the exact localized string without a DOM Toaster.
const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: vi.fn(), info: vi.fn() } }));

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const VARIANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const ENDPOINT = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/product-pricing/price`;

// Pull the exact localized strings from the catalog so the assertions don't
// duplicate (and drift from) the Turkish copy — and sidestep the apostrophe.
const SAVE_MESSAGES = trMessages.features.productPricing.panel.save;

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="tr" messages={trMessages} timeZone="Europe/Istanbul">
          {children}
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
  };
}

const ARGS = {
  orgId: ORG_ID,
  storeId: STORE_ID,
  variantId: VARIANT_ID,
  salePrice: '1499.90',
};

afterEach(() => {
  toastSuccess.mockReset();
});

describe('useUpdatePrice', () => {
  it('sends the variantId + salePrice in the body and resolves on SUCCESS', async () => {
    let capturedBody: unknown;
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(
          { status: 'SUCCESS', variantId: VARIANT_ID, newSalePrice: '1499.90', batchId: 'b-1' },
          { status: 200 },
        );
      }),
    );

    const { result } = renderHook(() => useUpdatePrice(ORG_ID, STORE_ID), {
      wrapper: makeWrapper(createTestQueryClient()),
    });
    result.current.mutate(ARGS);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedBody).toEqual({ variantId: VARIANT_ID, salePrice: '1499.90' });
    expect(result.current.data?.status).toBe('SUCCESS');
  });

  it('toasts the SUCCESS message and invalidates the product-pricing list', async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json(
          { status: 'SUCCESS', variantId: VARIANT_ID, newSalePrice: '1499.90', batchId: 'b-1' },
          { status: 200 },
        ),
      ),
    );

    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useUpdatePrice(ORG_ID, STORE_ID), {
      wrapper: makeWrapper(client),
    });
    result.current.mutate(ARGS);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(toastSuccess).toHaveBeenCalledWith(SAVE_MESSAGES.successToast);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['product-pricing', 'list', ORG_ID, STORE_ID],
    });
  });

  it('toasts the PENDING message when the marketplace did not confirm in time', async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json(
          { status: 'PENDING', variantId: VARIANT_ID, newSalePrice: '1499.90', batchId: 'b-2' },
          { status: 200 },
        ),
      ),
    );

    const { result } = renderHook(() => useUpdatePrice(ORG_ID, STORE_ID), {
      wrapper: makeWrapper(createTestQueryClient()),
    });
    result.current.mutate(ARGS);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.status).toBe('PENDING');
    expect(toastSuccess).toHaveBeenCalledWith(SAVE_MESSAGES.pendingToast);
  });

  it('throws an ApiError on a 422 MARKETPLACE_WRITE_FAILED (no success toast)', async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Marketplace write failed',
            status: 422,
            code: 'MARKETPLACE_WRITE_FAILED',
            detail: 'Trendyol rejected the price item',
          },
          { status: 422, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    const { result } = renderHook(() => useUpdatePrice(ORG_ID, STORE_ID), {
      wrapper: makeWrapper(createTestQueryClient()),
    });
    result.current.mutate(ARGS);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
