import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useRefreshOrders } from '@/features/orders/hooks/use-refresh-orders';
import { orderKeys } from '@/features/orders/query-keys';

describe('useRefreshOrders', () => {
  it('invalidates the orders list + KPI summary query keys when mutated', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useRefreshOrders('org-1', 'store-1'), { wrapper });

    await result.current.mutateAsync();

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: orderKeys.lists('org-1', 'store-1'),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: orderKeys.summaries('org-1', 'store-1'),
      });
    });
  });

  it('is a no-op when orgId or storeId is null', async () => {
    const client = new QueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useRefreshOrders(null, null), { wrapper });

    await result.current.mutateAsync();

    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
