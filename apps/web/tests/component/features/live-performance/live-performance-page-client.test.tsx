import type { QueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LivePerformanceOrders } from '@/features/live-performance/api/get-live-orders.api';
import { LivePerformancePageClient } from '@/features/live-performance/components/live-performance-page-client';
import { liveKeys } from '@/features/live-performance/query-keys';

import { server, http, HttpResponse } from '../../../helpers/msw';
import { NuqsTestHarness } from '../../../helpers/nuqs';
import {
  AllProviders,
  createTestQueryClient,
  render,
  screen,
  waitFor,
} from '../../../helpers/render';

// The Realtime-backed notifier is mounted by the dashboard layout; the page only
// reads channel health from it. Stub the hook so no channel is built here.
vi.mock('@/features/live-performance/providers/new-order-notifier-provider', () => ({
  useNewOrderNotifier: () => ({ health: 'healthy' }),
}));

// The chart is `dynamic(..., { ssr: false })` over recharts, which cannot run in
// happy-dom. Replace the loader with an inert component.
vi.mock('next/dynamic', () => ({ default: () => () => null }));

// Every section owns its own query and has its own component test. Stub them so
// this test stays pinned to the page header's refresh control.
vi.mock('@/features/live-performance/components/live-kpi-row', () => ({
  LiveKpiRow: () => null,
}));
vi.mock('@/features/live-performance/components/live-today-products', () => ({
  LiveTodayProducts: () => null,
}));
vi.mock('@/features/live-performance/components/live-orders-table', () => ({
  LiveOrdersTable: () => null,
}));
vi.mock('@/features/live-performance/components/live-order-detail-sheet', () => ({
  LiveOrderDetailSheet: () => null,
}));

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const STORE_ID = '00000000-0000-0000-0000-000000000002';
const BASE_URL = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/live-performance`;

const KPIS = {
  revenueToday: '160.00',
  revenueYesterday: '120.00',
  orderCountToday: 2,
  orderCountYesterday: 1,
  unitsSoldToday: 5,
  unitsSoldYesterday: 3,
  netProfitToday: '20.00',
  netProfitYesterday: '15.00',
  marginToday: '20.00',
  marginYesterday: '18.75',
  profitCostRatioToday: '33.33',
  profitCostRatioYesterday: '30.00',
  pendingRevenueToday: '60.00',
  pendingOrderCountToday: 1,
};

const ORDERS: LivePerformanceOrders = {
  data: [],
  total: 0,
  counts: { all: 0, calculated: 0, pending: 0 },
};

/**
 * One provider shape for both passes (server string + client hydrate) so the
 * trees line up and only the component under test can cause a mismatch.
 */
function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }): React.ReactElement {
    return (
      <AllProviders queryClient={queryClient}>
        <NuqsTestHarness>{children}</NuqsTestHarness>
      </AllProviders>
    );
  };
}

const page = (
  <LivePerformancePageClient
    orgId={ORG_ID}
    storeId={STORE_ID}
    pageTitle="Canlı Performans"
    pageIntent="Bugünün anlık görünümü"
  />
);

describe('LivePerformancePageClient — refresh control hydration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the refresh control hydration-safe while a live query is already in flight, then reflects it once mounted', async () => {
    server.use(
      http.get(`${BASE_URL}/kpis`, () => HttpResponse.json(KPIS)),
      // Safety net only: the page's orders observer joins the in-flight
      // fetchQuery below (same key) and the stale window prevents a refetch, so
      // this handler is not hit unless the key or the dedupe behaviour changes.
      http.get(`${BASE_URL}/orders`, () => HttpResponse.json(ORDERS)),
    );

    // React 19 reports attribute mismatches through console.error (it does not
    // patch them up) and text/structure mismatches through onRecoverableError.
    // The spy covers BOTH passes, so a server-side warning cannot hide either.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onRecoverableError = vi.fn();

    // Server pass: no query runs during SSR, so nothing is ever fetching.
    const ServerWrapper = makeWrapper(createTestQueryClient());
    const container = document.createElement('div');
    container.innerHTML = renderToString(<ServerWrapper>{page}</ServerWrapper>);
    document.body.appendChild(container);

    // Client pass: the dashboard layout's NewOrderNotifierProvider primes its
    // baseline through the query cache (`fetchQuery` on liveKeys.orders) and
    // commits BEFORE the page segment — behind the route group's loading
    // boundary — hydrates. So a live-performance query is already in flight.
    const clientQueryClient = createTestQueryClient();
    let resolveOrders: (value: LivePerformanceOrders) => void = () => undefined;
    const inFlight = clientQueryClient.fetchQuery({
      queryKey: liveKeys.orders(ORG_ID, STORE_ID, 'all'),
      queryFn: () =>
        new Promise<LivePerformanceOrders>((resolve) => {
          resolveOrders = resolve;
        }),
    });
    expect(clientQueryClient.isFetching({ queryKey: liveKeys.all })).toBe(1);

    try {
      render(page, {
        wrapper: makeWrapper(clientQueryClient),
        hydrate: true,
        container,
        onRecoverableError,
      });

      // Nothing may be logged by either pass — not only the mismatch text — so
      // any unrelated React warning in the server or hydrated tree surfaces too.
      const logged = consoleError.mock.calls.map((args) =>
        args.map(String).join(' ').slice(0, 600),
      );
      expect(logged).toEqual([]);
      expect(onRecoverableError).not.toHaveBeenCalled();

      // Once mounted, the in-flight state must still surface on the control.
      const button = screen.getByRole('button', { name: 'Yenile' });
      await waitFor(() => expect(button).toBeDisabled());

      resolveOrders(ORDERS);
      await inFlight;
      await waitFor(() => expect(button).toBeEnabled());
    } finally {
      // On a failed assertion, still let the in-flight requests settle through
      // MSW — otherwise the page's KPI fetch outlives `server.close()` and
      // prints an unrelated ECONNREFUSED next to the real failure. Nothing here
      // may throw, so the original failure stays the reported one. The green
      // path needs no extra check: `toBeEnabled` above already requires every
      // live query to have settled.
      resolveOrders(ORDERS);
      await inFlight.catch(() => undefined);
      await waitFor(() => expect(clientQueryClient.isFetching()).toBe(0)).catch(() => undefined);
    }
  });
});
