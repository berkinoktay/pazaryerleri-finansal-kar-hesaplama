import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useLiveKpis } from '@/features/live-performance/hooks/use-live-kpis';
import { ApiError } from '@/lib/api-error';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const URL = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/live-performance/kpis`;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

const kpis = {
  revenueToday: '1000.00',
  revenueYesterday: '800.00',
  netProfitToday: '200.00',
  netProfitYesterday: '150.00',
  orderCountToday: 10,
  orderCountYesterday: 8,
  marginToday: '20.00',
  marginYesterday: '18.75',
};

describe('useLiveKpis', () => {
  it('returns the KPI payload on success', async () => {
    server.use(http.get(URL, () => HttpResponse.json(kpis, { status: 200 })));

    const { result } = renderHook(() => useLiveKpis(ORG_ID, STORE_ID), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.revenueToday).toBe('1000.00');
    expect(result.current.data?.orderCountToday).toBe(10);
  });

  it('does not fire when org/store is null (enabled=false)', () => {
    const { result } = renderHook(() => useLiveKpis(null, null), { wrapper });
    expect(result.current.isFetching).toBe(false);
    expect(result.current.status).toBe('pending');
  });

  it('surfaces an ApiError on 403', async () => {
    server.use(
      http.get(URL, () =>
        HttpResponse.json(
          {
            type: 'https://api.pazarsync.com/errors/forbidden',
            title: 'Access denied',
            status: 403,
            code: 'FORBIDDEN',
            detail: 'Not a member',
          },
          { status: 403 },
        ),
      ),
    );

    const { result } = renderHook(() => useLiveKpis(ORG_ID, STORE_ID), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect((result.current.error as ApiError).code).toBe('FORBIDDEN');
  });
});
