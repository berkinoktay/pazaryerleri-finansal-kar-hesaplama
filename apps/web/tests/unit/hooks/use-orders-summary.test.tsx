import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrderSummary } from '@/features/orders/api/get-orders-summary.api';
import type { FinalizingPoll } from '@/features/orders/hooks/use-finalizing-poll';
import { useOrdersSummary } from '@/features/orders/hooks/use-orders-summary';
import { FINALIZING_POLL_MS } from '@/features/orders/lib/finalizing-poll';

import { HttpResponse, http, server } from '../../helpers/msw';
import { createTestQueryClient } from '../../helpers/render';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const STORE_ID = '22222222-2222-2222-2222-222222222222';
const URL = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/orders/summary`;

// One poll tick plus a margin: the observer re-arms its interval when each
// response lands, so a tick is due slightly after FINALIZING_POLL_MS.
const POLL_STEP_MS = FINALIZING_POLL_MS + 500;

const SUMMARY: OrderSummary = {
  totalRevenueGross: '720',
  netProfitGross: '80',
  avgMarginPct: '11.11',
  lossOrderRate: { lossCount: 1, totalCount: 3, pct: '33.33' },
};

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

describe('useOrdersSummary polling', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Advance one poll tick, then wait until any fetch it started has landed.
  async function advancePoll(client: QueryClient): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_STEP_MS);
    });
    await waitFor(() => expect(client.isFetching()).toBe(0));
  }

  it('polls while the given pollInterval returns a number and not without it', async () => {
    let calls = 0;
    server.use(
      http.get(URL, () => {
        calls += 1;
        return HttpResponse.json(SUMMARY);
      }),
    );

    // Mount the summary with `options`, let two poll ticks pass, report the fetch count.
    async function fetchCountOverTwoTicks(options?: {
      pollInterval?: FinalizingPoll['forSummary'];
    }): Promise<number> {
      calls = 0;
      const client = createTestQueryClient();
      const { result, unmount } = renderHook(
        () => useOrdersSummary({ orgId: ORG_ID, storeId: STORE_ID }, options),
        {
          wrapper: ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={client}>{children}</QueryClientProvider>
          ),
        },
      );
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      await advancePoll(client);
      await advancePoll(client);
      unmount();
      return calls;
    }

    const polling = vi.fn((): number | false => FINALIZING_POLL_MS);
    expect(await fetchCountOverTwoTicks({ pollInterval: polling })).toBe(3);
    expect(polling).toHaveBeenCalled();

    const notPolling = vi.fn((): number | false => false);
    expect(await fetchCountOverTwoTicks({ pollInterval: notPolling })).toBe(1);
    expect(notPolling).toHaveBeenCalled();

    expect(await fetchCountOverTwoTicks()).toBe(1);
  });
});
