import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useLiveTodayProducts } from '@/features/live-performance/hooks/use-live-today-products';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const URL = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/live-performance/today-products`;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

const todayProducts = {
  data: [
    {
      variantId: 'v-1',
      barcode: '8690000000001',
      stockCode: 'STK-1',
      productName: 'X Marka Kazak',
      thumbUrl: null,
      orderCount: 5,
      unitsSold: 8,
      revenue: '1250.00',
      costStatus: 'costed',
      unitCost: '42.00',
    },
    {
      variantId: 'v-2',
      barcode: '8690000000002',
      stockCode: 'STK-2',
      productName: 'Y Marka Pantolon',
      thumbUrl: null,
      orderCount: 2,
      unitsSold: 3,
      revenue: '600.00',
      costStatus: 'missing',
      unitCost: null,
    },
  ],
};

describe('useLiveTodayProducts', () => {
  it('returns the merged per-product rows on success, preserving cost status', async () => {
    server.use(http.get(URL, () => HttpResponse.json(todayProducts, { status: 200 })));

    const { result } = renderHook(() => useLiveTodayProducts(ORG_ID, STORE_ID), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data).toHaveLength(2);
    expect(result.current.data?.data[0]?.costStatus).toBe('costed');
    expect(result.current.data?.data[1]?.unitCost).toBeNull();
  });

  it('does not fire when org/store is null', () => {
    const { result } = renderHook(() => useLiveTodayProducts(ORG_ID, null), { wrapper });
    expect(result.current.isFetching).toBe(false);
    expect(result.current.status).toBe('pending');
  });
});
