import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ListOrdersArgs, ListOrdersResponse } from '@/features/orders/api/list-orders.api';
import { useFinalizingPoll } from '@/features/orders/hooks/use-finalizing-poll';
import { useOrders } from '@/features/orders/hooks/use-orders';
import { FINALIZING_POLL_MAX_MS, FINALIZING_POLL_MS } from '@/features/orders/lib/finalizing-poll';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const STORE_ID = '22222222-2222-2222-2222-222222222222';
const URL = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/orders`;

// One poll tick plus a margin: the observer re-arms its interval when each
// response lands, so a tick is due slightly after FINALIZING_POLL_MS.
const POLL_STEP_MS = FINALIZING_POLL_MS + 500;

const ARGS: ListOrdersArgs = { orgId: ORG_ID, storeId: STORE_ID, page: 1, perPage: 25 };

function listResponse(
  overrides: { finalizing?: boolean; counts?: ListOrdersResponse['counts'] } = {},
): ListOrdersResponse {
  return {
    data: [],
    pagination: { page: 1, perPage: 25, total: 0, totalPages: 0 },
    counts: overrides.counts ?? { calculated: 0, excluded: 0 },
    // The hook reads only `finalizing`; the dates are inert past dates.
    openDay: {
      businessDate: '2026-05-15',
      lastCompletedBusinessDate: '2026-05-14',
      finalizing: overrides.finalizing ?? false,
      todayOrderCount: 0,
      matches: [],
    },
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

describe('useOrders', () => {
  it('sends the active costStatus segment as a query param', async () => {
    let receivedCostStatus: string | null = null;
    server.use(
      http.get(URL, ({ request }) => {
        receivedCostStatus = new global.URL(request.url).searchParams.get('costStatus');
        return HttpResponse.json(listResponse({ counts: { calculated: 0, excluded: 3 } }));
      }),
    );

    const { result } = renderHook(
      () =>
        useOrders({
          orgId: ORG_ID,
          storeId: STORE_ID,
          costStatus: 'excluded',
          page: 1,
          perPage: 25,
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(receivedCostStatus).toBe('excluded');
    expect(result.current.data?.counts).toEqual({ calculated: 0, excluded: 3 });
  });
});

describe('useOrders polling while finalizing', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Mirrors the page: one shared poll, its list half handed to useOrders.
  function useOrdersWithFinalizingPoll(args: ListOrdersArgs) {
    const poll = useFinalizingPoll();
    return useOrders(args, { pollInterval: poll.fromList });
  }

  function renderPolledOrders(client: QueryClient) {
    return renderHook(() => useOrdersWithFinalizingPoll(ARGS), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
  }

  // Advance one poll tick, then wait until any fetch it started has landed, so
  // the next tick is scheduled from the applied response.
  async function advancePoll(client: QueryClient): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_STEP_MS);
    });
    await waitFor(() => expect(client.isFetching()).toBe(0));
  }

  it('refetches while the response says finalizing', async () => {
    let calls = 0;
    server.use(
      http.get(URL, () => {
        calls += 1;
        return HttpResponse.json(listResponse({ finalizing: calls <= 2 }));
      }),
    );
    const client = createTestQueryClient();
    const { result } = renderPolledOrders(client);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls).toBe(1);

    await advancePoll(client);
    expect(calls).toBe(2);

    await advancePoll(client);
    expect(calls).toBe(3);

    // The third response says false: polling stops.
    await advancePoll(client);
    expect(calls).toBe(3);
  });

  it('does not poll when finalizing is false', async () => {
    let calls = 0;
    server.use(
      http.get(URL, () => {
        calls += 1;
        return HttpResponse.json(listResponse({ finalizing: false }));
      }),
    );
    const client = createTestQueryClient();
    const { result } = renderPolledOrders(client);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await advancePoll(client);
    await advancePoll(client);

    expect(calls).toBe(1);
    expect(client.isFetching()).toBe(0);
  });

  it('stops polling after FINALIZING_POLL_MAX_MS', async () => {
    let calls = 0;
    server.use(
      http.get(URL, () => {
        calls += 1;
        return HttpResponse.json(listResponse({ finalizing: true }));
      }),
    );
    const client = createTestQueryClient();
    const { result } = renderPolledOrders(client);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Control: it polls before the cap.
    await advancePoll(client);
    await advancePoll(client);
    expect(calls).toBe(3);

    // Jump past the cap without firing timers. The cap is read when the
    // interval callback re-runs, so one more tick may still land.
    vi.setSystemTime(Date.now() + FINALIZING_POLL_MAX_MS);
    await advancePoll(client);
    const callsAtCap = calls;

    await advancePoll(client);
    await advancePoll(client);
    expect(calls).toBe(callsAtCap);
    expect(client.isFetching()).toBe(0);
  });
});
