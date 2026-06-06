import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { http, HttpResponse, server } from '../../helpers/msw';
import { createTestQueryClient } from '../../helpers/render';
import { useSetOrderItemCost } from '@/features/live-performance/hooks/use-set-order-item-cost';

const ORG = '11111111-1111-1111-1111-111111111111';
const STORE = '22222222-2222-2222-2222-222222222222';
const ORDER = '44444444-4444-4444-4444-444444444444';
const ITEM = '55555555-5555-5555-5555-555555555555';

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

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
    const { result } = renderHook(() => useSetOrderItemCost(ORG, STORE, ORDER), { wrapper });
    result.current.mutate({
      itemId: ITEM,
      body: { source: 'manual', netAmount: '42.00', vatRate: 20 },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
