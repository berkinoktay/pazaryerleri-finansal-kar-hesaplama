import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useReturns } from '@/features/returns/hooks/use-returns';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const STORE_ID = '22222222-2222-2222-2222-222222222222';
const URL = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/claims`;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

describe('useReturns', () => {
  it('fetches claims with filters mapped to query params and exposes counts', async () => {
    let receivedParams: Record<string, string | null> = {};
    server.use(
      http.get(URL, ({ request }) => {
        const url = new global.URL(request.url);
        receivedParams = {
          status: url.searchParams.get('status'),
          q: url.searchParams.get('q'),
          page: url.searchParams.get('page'),
        };
        return HttpResponse.json({
          data: [
            {
              id: 'c1',
              orderId: 'o1',
              platformOrderNumber: '11101228439',
              trendyolClaimId: 't1',
              claimDate: '2026-06-10T10:00:00.000Z',
              resolved: false,
              derivedStatus: 'OPEN',
              scope: 'PARTIAL',
              itemCount: 1,
              productSummary: { firstName: 'Boyunluk', units: 1, otherCount: 0 },
              reasonSummary: { first: 'Hasarlı ürün', otherCount: 0 },
              cargoProviderName: null,
              cargoTrackingNumber: null,
            },
          ],
          pagination: { page: 1, perPage: 25, total: 1, totalPages: 1 },
          counts: { all: 1, open: 1, resolved: 0 },
        });
      }),
    );

    const { result } = renderHook(
      () =>
        useReturns({
          orgId: ORG_ID,
          storeId: STORE_ID,
          status: 'open',
          q: '1110',
          page: 1,
          perPage: 25,
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.counts).toEqual({ all: 1, open: 1, resolved: 0 });
    expect(result.current.data?.data[0]?.derivedStatus).toBe('OPEN');
    expect(receivedParams['status']).toBe('open');
    expect(receivedParams['q']).toBe('1110');
    expect(receivedParams['page']).toBe('1');
  });

  it('omits the status param entirely when no status filter is set (the "all" tab)', async () => {
    let statusParamPresent: boolean | null = null;
    server.use(
      http.get(URL, ({ request }) => {
        statusParamPresent = new global.URL(request.url).searchParams.has('status');
        return HttpResponse.json({
          data: [],
          pagination: { page: 1, perPage: 25, total: 0, totalPages: 0 },
          counts: { all: 0, open: 0, resolved: 0 },
        });
      }),
    );

    const { result } = renderHook(
      () => useReturns({ orgId: ORG_ID, storeId: STORE_ID, page: 1, perPage: 25 }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(statusParamPresent).toBe(false);
  });
});
