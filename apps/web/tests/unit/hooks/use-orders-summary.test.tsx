import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useOrdersSummary } from '@/features/orders/hooks/use-orders-summary';

import { HttpResponse, http, server } from '../../helpers/msw';
import { createTestQueryClient } from '../../helpers/render';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const STORE_ID = '22222222-2222-2222-2222-222222222222';
const URL = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/orders/summary`;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

describe('useOrdersSummary', () => {
  it('returns the KPI summary and forwards lossOnly as a query param', async () => {
    let receivedLossOnly: string | null = null;
    server.use(
      http.get(URL, ({ request }) => {
        receivedLossOnly = new global.URL(request.url).searchParams.get('lossOnly');
        return HttpResponse.json({
          totalRevenueGross: '720',
          netProfitGross: '80',
          avgMarginPct: '11.11',
          lossOrderRate: { lossCount: 1, totalCount: 3, pct: '33.33' },
        });
      }),
    );

    const { result } = renderHook(
      () => useOrdersSummary({ orgId: ORG_ID, storeId: STORE_ID, lossOnly: true }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(receivedLossOnly).toBe('true');
    expect(result.current.data?.netProfitGross).toBe('80');
    expect(result.current.data?.lossOrderRate.lossCount).toBe(1);
  });

  it('is disabled (no fetch) when args is null', async () => {
    const { result } = renderHook(() => useOrdersSummary(null), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.data).toBeUndefined();
  });
});
