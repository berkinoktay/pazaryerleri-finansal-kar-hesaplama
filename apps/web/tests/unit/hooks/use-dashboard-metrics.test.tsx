import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';

import { useDashboardMetrics } from '@/features/dashboard/hooks/use-dashboard-metrics';

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useDashboardMetrics', () => {
  it('returns metrics for a valid org/store/period', async () => {
    const { result } = renderHook(
      () => useDashboardMetrics({ orgId: 'o1', storeId: 's1', period: 'last-30d' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.kpis.revenue.toString()).toBe('284390.45');
    expect(result.current.data?.costBreakdown).toHaveLength(8);
    expect(result.current.data?.funnel).toHaveLength(5);
  });

  it('does not fetch when storeId is empty', async () => {
    const { result } = renderHook(
      () => useDashboardMetrics({ orgId: 'o1', storeId: '', period: 'last-30d' }),
      { wrapper },
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.fetchStatus).toBe('idle');
  });
});
