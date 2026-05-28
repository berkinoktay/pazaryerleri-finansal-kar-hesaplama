import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useLiveTopProducts } from '@/features/live-performance/hooks/use-live-top-products';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const URL = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/live-performance/top-products`;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

const topProducts = {
  data: [
    {
      rank: 1,
      variantId: 'v-1',
      productName: 'X Marka Kazak',
      thumbUrl: null,
      orderCount: 5,
      revenue: '1250.00',
      profit: '320.00',
    },
    {
      rank: 2,
      variantId: 'v-2',
      productName: 'Y Marka Pantolon',
      thumbUrl: 'https://cdn.example.com/v2.jpg',
      orderCount: 3,
      revenue: '900.00',
      profit: null,
    },
  ],
};

describe('useLiveTopProducts', () => {
  it('returns the ranked top products on success, preserving null profit', async () => {
    server.use(http.get(URL, () => HttpResponse.json(topProducts, { status: 200 })));

    const { result } = renderHook(() => useLiveTopProducts(ORG_ID, STORE_ID), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data[0]?.rank).toBe(1);
    expect(result.current.data?.data[1]?.profit).toBeNull();
  });

  it('does not fire when org/store is null', () => {
    const { result } = renderHook(() => useLiveTopProducts(null, null), { wrapper });
    expect(result.current.isFetching).toBe(false);
    expect(result.current.status).toBe('pending');
  });
});
