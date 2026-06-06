import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useSetOrderItemCost } from '@/features/orders/hooks/use-set-order-item-cost';
import { orderKeys } from '@/features/orders/query-keys';

import { http, HttpResponse, server } from '../../helpers/msw';
import { createTestQueryClient } from '../../helpers/render';

const ORG = '11111111-1111-1111-1111-111111111111';
const STORE = '22222222-2222-2222-2222-222222222222';
const ORDER = '44444444-4444-4444-4444-444444444444';
const ITEM = '55555555-5555-5555-5555-555555555555';

describe('useSetOrderItemCost', () => {
  it('PATCHes the item cost and resolves', async () => {
    server.use(
      http.patch(`*/orders/${ORDER}/items/${ITEM}/cost`, () =>
        HttpResponse.json(
          { id: ORDER, items: [], fees: [], claims: [], estimatedNetProfit: '100.00' },
          { status: 200 },
        ),
      ),
    );
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useSetOrderItemCost(ORG, STORE, ORDER), { wrapper });
    result.current.mutate({
      itemId: ITEM,
      body: { source: 'manual', netAmount: '42.00', vatRate: 20 },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('invalidates orderKeys.detail + orderKeys.lists and never touches live-performance keys', async () => {
    server.use(
      http.patch(`*/orders/${ORDER}/items/${ITEM}/cost`, () =>
        HttpResponse.json(
          { id: ORDER, items: [], fees: [], claims: [], estimatedNetProfit: '100.00' },
          { status: 200 },
        ),
      ),
    );

    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useSetOrderItemCost(ORG, STORE, ORDER), { wrapper });
    result.current.mutate({
      itemId: ITEM,
      body: { source: 'manual', netAmount: '42.00', vatRate: 20 },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const invalidatedKeys = invalidateSpy.mock.calls.map(([arg]) => arg?.queryKey);

    // (1) detail refresh so the cost snapshot lands on the open order
    expect(invalidatedKeys).toContainEqual(orderKeys.detail(ORG, STORE, ORDER));
    // (2) list/counts refresh so the order graduates pending -> calculated
    expect(invalidatedKeys).toContainEqual(orderKeys.lists(ORG, STORE));
    // (3) NEVER reach back into live-performance (would be an orders -> live-performance
    //     reverse edge = boundary audit error). The live caller re-adds liveKeys via onCosted.
    const touchesLivePerf = invalidatedKeys.some(
      (key) => Array.isArray(key) && key[0] === 'live-performance',
    );
    expect(touchesLivePerf).toBe(false);
  });
});
