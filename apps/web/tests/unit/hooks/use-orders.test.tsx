import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useOrders } from '@/features/orders/hooks/use-orders';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const STORE_ID = '22222222-2222-2222-2222-222222222222';
const URL = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/orders`;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

describe('useOrders', () => {
  it('sends the active costStatus segment as a query param', async () => {
    let receivedCostStatus: string | null = null;
    server.use(
      http.get(URL, ({ request }) => {
        receivedCostStatus = new global.URL(request.url).searchParams.get('costStatus');
        return HttpResponse.json({
          data: [],
          pagination: { page: 1, perPage: 25, total: 0, totalPages: 0 },
          counts: { calculated: 0, pending: 3 },
        });
      }),
    );

    const { result } = renderHook(
      () =>
        useOrders({
          orgId: ORG_ID,
          storeId: STORE_ID,
          costStatus: 'pending',
          page: 1,
          perPage: 25,
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(receivedCostStatus).toBe('pending');
    expect(result.current.data?.counts).toEqual({ calculated: 0, pending: 3 });
  });
});
