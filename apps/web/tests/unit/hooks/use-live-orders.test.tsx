import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useLiveOrders } from '@/features/live-performance/hooks/use-live-orders';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const URL = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/live-performance/orders`;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

const ordersResponse = {
  data: [
    {
      source: 'orders',
      platformOrderId: 'po-1',
      platformOrderNumber: 'TY-1001',
      orderDate: '2026-05-28T09:30:00Z',
      status: 'Created',
      revenue: '300.00',
      profit: '80.00',
      margin: '26.67',
    },
    {
      source: 'buffer',
      platformOrderId: 'po-2',
      platformOrderNumber: null,
      orderDate: '2026-05-28T10:15:00Z',
      status: 'Created',
      revenue: '150.00',
      profit: null,
      margin: null,
    },
  ],
  total: 2,
  counts: { all: 2, calculated: 1, pending: 1 },
};

describe('useLiveOrders', () => {
  it('returns the union feed and per-tab counts on success', async () => {
    server.use(http.get(URL, () => HttpResponse.json(ordersResponse, { status: 200 })));

    const { result } = renderHook(() => useLiveOrders(ORG_ID, STORE_ID, 'all'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.counts).toEqual({ all: 2, calculated: 1, pending: 1 });
    expect(result.current.data?.data[1]?.source).toBe('buffer');
    expect(result.current.data?.data[1]?.profit).toBeNull();
  });

  it('forwards the active filter as a query param', async () => {
    let capturedUrl = '';
    server.use(
      http.get(URL, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(ordersResponse, { status: 200 });
      }),
    );

    const { result } = renderHook(() => useLiveOrders(ORG_ID, STORE_ID, 'pending'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedUrl).toContain('filter=pending');
  });

  it('does not fire when org/store is null', () => {
    const { result } = renderHook(() => useLiveOrders(null, STORE_ID, 'all'), { wrapper });
    expect(result.current.isFetching).toBe(false);
    expect(result.current.status).toBe('pending');
  });
});
