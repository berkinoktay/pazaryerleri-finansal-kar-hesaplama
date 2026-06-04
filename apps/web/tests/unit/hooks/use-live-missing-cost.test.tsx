import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useLiveMissingCost } from '@/features/live-performance/hooks/use-live-missing-cost';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const URL = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/live-performance/missing-cost`;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

const missingCost = {
  data: [
    {
      variantId: 'v-1',
      barcode: '8690000000001',
      stockCode: 'STK-KAZAK-01',
      productName: 'X Marka Kazak',
      thumbUrl: null,
      orderCount: 3,
      revenueImpact: '750.00',
    },
  ],
};

describe('useLiveMissingCost', () => {
  it('returns the variant-grouped missing-cost rows on success', async () => {
    server.use(http.get(URL, () => HttpResponse.json(missingCost, { status: 200 })));

    const { result } = renderHook(() => useLiveMissingCost(ORG_ID, STORE_ID), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data).toHaveLength(1);
    expect(result.current.data?.data[0]?.revenueImpact).toBe('750.00');
    expect(result.current.data?.data[0]?.thumbUrl).toBeNull();
  });

  it('does not fire when org/store is null', () => {
    const { result } = renderHook(() => useLiveMissingCost(ORG_ID, null), { wrapper });
    expect(result.current.isFetching).toBe(false);
    expect(result.current.status).toBe('pending');
  });
});
