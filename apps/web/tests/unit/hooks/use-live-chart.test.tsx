import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useLiveChart } from '@/features/live-performance/hooks/use-live-chart';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const URL = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/live-performance/chart`;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

const chart = {
  today: [
    { hour: 0, cumulativeProfit: '0.00' },
    { hour: 1, cumulativeProfit: '120.50' },
  ],
  yesterday: [
    { hour: 0, cumulativeProfit: '0.00' },
    { hour: 1, cumulativeProfit: '90.00' },
  ],
};

describe('useLiveChart', () => {
  it('returns the today/yesterday cumulative series on success', async () => {
    server.use(http.get(URL, () => HttpResponse.json(chart, { status: 200 })));

    const { result } = renderHook(() => useLiveChart(ORG_ID, STORE_ID), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.today[1]?.cumulativeProfit).toBe('120.50');
    expect(result.current.data?.yesterday).toHaveLength(2);
  });

  it('does not fire when org/store is null', () => {
    const { result } = renderHook(() => useLiveChart(null, STORE_ID), { wrapper });
    expect(result.current.isFetching).toBe(false);
    expect(result.current.status).toBe('pending');
  });
});
