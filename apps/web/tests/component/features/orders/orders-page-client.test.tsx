import type { QueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { createTranslator } from 'next-intl';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatCurrency, getBusinessDate, getBusinessDayRangeOfDate } from '@pazarsync/utils';

import type { OrderSummary } from '@/features/orders/api/get-orders-summary.api';
import type {
  ListOrdersResponse,
  OpenDayMatch,
  OrderListOpenDay,
} from '@/features/orders/api/list-orders.api';
import { OrdersPageClient } from '@/features/orders/components/orders-page-client';
import { ORDERS_REALTIME_REFRESH_DEBOUNCE_MS } from '@/features/orders/hooks/use-orders-realtime-refresh';
import { FINALIZING_POLL_MAX_MS, FINALIZING_POLL_MS } from '@/features/orders/lib/finalizing-poll';
import { publishCompletedDayOrder } from '@/lib/recent-orders-bus';
import { ROLLOVER_GRACE_MS } from '@/lib/use-business-day-rollover';
import { COUNT_UP_DURATION_MS } from '@/lib/use-count-up';

import trMessages from '../../../../messages/tr.json';
import { HttpResponse, http, server } from '../../../helpers/msw';
import { NuqsTestHarness } from '../../../helpers/nuqs';
import {
  act,
  AllProviders,
  createTestQueryClient,
  render,
  screen,
  waitFor,
  within,
} from '../../../helpers/render';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// The sync chrome reads the org-wide sync provider and Realtime; it has its own
// tests. Stub it so this test stays pinned to the page's orders wiring.
vi.mock('@/features/sync/components/page-sync-control', () => ({ PageSyncControl: () => null }));
vi.mock('@/features/sync/components/page-sync-footer-trace', () => ({
  PageSyncFooterTrace: () => null,
}));
vi.mock('@/features/sync/components/stale-data-banner', () => ({ StaleDataBanner: () => null }));
vi.mock('@/features/sync/hooks/use-store-syncs', () => ({
  useStoreSyncs: () => ({ activeSyncs: [], recentSyncs: [] }),
}));
vi.mock('@/components/patterns/sync-center', () => ({ SyncCenter: () => null }));
vi.mock('@/features/orders/components/order-detail-sheet', () => ({
  OrderDetailSheet: () => null,
}));

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const STORE_ID = '00000000-0000-0000-0000-000000000002';
const LIST_URL = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/orders`;
const SUMMARY_URL = `${LIST_URL}/summary`;

const DAY_MS = 24 * 60 * 60 * 1000;
// One poll tick plus a margin: an observer re-arms its interval when each
// response lands, so a tick is due slightly after FINALIZING_POLL_MS.
const POLL_STEP_MS = FINALIZING_POLL_MS + 500;

// Copy comes from the catalog, never a literal: the Turkish values will change.
const tOpenDay = createTranslator({
  locale: 'tr',
  messages: trMessages,
  namespace: 'ordersPage.openDay',
});

const PRE_CLOSE_PROFIT = '1234.00';
const POST_CLOSE_PROFIT = '4321.00';

/**
 * A list response whose open day defaults to the business date of the clock the
 * test runs under (read when the handler runs, so a fake clock moves it too):
 * the page arms its day-rollover timer from `businessDate`, and a past date
 * would fire it at once.
 */
function listResponse(
  over: {
    openDay?: Partial<OrderListOpenDay>;
    counts?: ListOrdersResponse['counts'];
    pagination?: ListOrdersResponse['pagination'];
  } = {},
): ListOrdersResponse {
  return {
    data: [],
    pagination: over.pagination ?? { page: 1, perPage: 25, total: 0, totalPages: 0 },
    counts: over.counts ?? { calculated: 0, excluded: 0 },
    openDay: {
      businessDate: getBusinessDate(),
      lastCompletedBusinessDate: getBusinessDate(new Date(Date.now() - DAY_MS)),
      finalizing: false,
      todayOrderCount: 0,
      matches: [],
      ...over.openDay,
    },
  };
}

function summaryResponse(netProfitGross = PRE_CLOSE_PROFIT): OrderSummary {
  return {
    totalRevenueGross: '9999.00',
    netProfitGross,
    avgMarginPct: '12.50',
    lossOrderRate: { lossCount: 0, totalCount: 0, pct: '0.00' },
  };
}

interface HandlerCounts {
  list: number;
  summary: number;
}

/**
 * Register list + summary handlers that count calls; the list body comes from
 * `list`, given the call number and the request URL.
 */
function serve(
  list: (call: number, url: URL) => ListOrdersResponse,
  summary = summaryResponse,
): HandlerCounts {
  const counts: HandlerCounts = { list: 0, summary: 0 };
  server.use(
    http.get(SUMMARY_URL, () => {
      counts.summary += 1;
      return HttpResponse.json(summary());
    }),
    http.get(LIST_URL, ({ request }) => {
      counts.list += 1;
      return HttpResponse.json(list(counts.list, new URL(request.url)));
    }),
  );
  return counts;
}

function makeWrapper(queryClient: QueryClient, initialSearchParams = '') {
  return function Wrapper({ children }: { children: React.ReactNode }): React.ReactElement {
    return (
      <AllProviders queryClient={queryClient}>
        <NuqsTestHarness initialSearchParams={initialSearchParams}>{children}</NuqsTestHarness>
      </AllProviders>
    );
  };
}

function renderPage(queryClient: QueryClient, initialSearchParams = '') {
  return render(
    <OrdersPageClient
      orgId={ORG_ID}
      storeId={STORE_ID}
      pageTitle="orders-title"
      pageIntent="orders-intent"
    />,
    { wrapper: makeWrapper(queryClient, initialSearchParams) },
  );
}

async function waitForIdle(queryClient: QueryClient): Promise<void> {
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));
}

describe('OrdersPageClient - open day', () => {
  it('shows the finalizing note from the list response', async () => {
    serve(() => listResponse({ openDay: { finalizing: true } }));
    renderPage(createTestQueryClient());

    expect(await screen.findByText(tOpenDay('finalizing'))).toBeInTheDocument();
  });

  it('shows a live-performance link for a today match while the table is empty', async () => {
    const match: OpenDayMatch = {
      source: 'orders',
      id: '00000000-0000-0000-0000-0000000000a1',
      orderNumber: 'TY-TODAY-1',
      cancelled: false,
    };
    serve(() => listResponse({ openDay: { matches: [match] } }));
    renderPage(createTestQueryClient(), '?q=TY-TODAY-1');

    const link = await screen.findByRole('link', {
      name: tOpenDay('matchStored', { orderNumber: match.orderNumber }),
    });
    expect(link).toHaveAttribute('href', `/live-performance?order=${match.id}`);
    // The search matched no completed-day row: the table shows its zero-row body.
    expect(screen.getByText(trMessages.ordersPage.tabs.emptyCalculated)).toBeInTheDocument();
  });

  it('shows the today notice with a live-performance link when today has orders', async () => {
    serve(() =>
      listResponse({ openDay: { todayOrderCount: 2 }, counts: { calculated: 5, excluded: 0 } }),
    );
    renderPage(createTestQueryClient());

    expect(await screen.findByText(tOpenDay('todayNotice'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: tOpenDay('todayLink') })).toHaveAttribute(
      'href',
      '/live-performance',
    );
  });

  it("points to live performance from the empty state of a store whose only orders are today's", async () => {
    serve(() => listResponse({ openDay: { todayOrderCount: 3 } }));
    renderPage(createTestQueryClient());

    expect(await screen.findByText(trMessages.ordersPage.empty.openDayOnly)).toBeInTheDocument();
    expect(screen.queryByText(trMessages.ordersPage.empty.noOrders.title)).not.toBeInTheDocument();
    // The empty state inside the table carries its own pointer...
    const table = screen.getByRole('table');
    expect(within(table).getByRole('link', { name: tOpenDay('todayLink') })).toHaveAttribute(
      'href',
      '/live-performance',
    );
    // ...so the notice above the table leaves its own today line out (said once).
    expect(screen.getAllByRole('link', { name: tOpenDay('todayLink') })).toHaveLength(1);
  });

  it('today is not selectable in the date picker', async () => {
    const counts = serve(() =>
      listResponse({ openDay: { lastCompletedBusinessDate: '2026-05-14' } }),
    );
    const queryClient = createTestQueryClient();
    const { user } = renderPage(queryClient, '?from=2026-05-10');
    // The bound arrives with the first list response.
    await waitFor(() => expect(counts.list).toBe(1));
    await waitForIdle(queryClient);

    await user.click(
      screen.getByRole('button', {
        name: format(new Date(2026, 4, 10), 'd MMM yyyy', { locale: tr }),
      }),
    );

    const dayButton = (day: number): HTMLElement =>
      screen.getByRole('button', { name: format(new Date(2026, 4, day), 'PPPP', { locale: tr }) });
    expect(dayButton(15)).toBeDisabled();
    expect(dayButton(14)).toBeEnabled();
  });

  it('the open-day notice stays while the list page changes', async () => {
    // Page 2 is held until the test releases it, so the swap is observable.
    let releasePageTwo = (): void => {};
    const pageTwoHeld = new Promise<void>((resolve) => {
      releasePageTwo = resolve;
    });
    const counts = { list: 0 };
    server.use(
      http.get(SUMMARY_URL, () => HttpResponse.json(summaryResponse())),
      http.get(LIST_URL, async ({ request }) => {
        counts.list += 1;
        const onSecondPage = new URL(request.url).searchParams.get('page') === '2';
        if (onSecondPage) await pageTwoHeld;
        return HttpResponse.json(
          listResponse({
            // Page 2 also names today's orders, so its arrival is visible.
            openDay: { finalizing: true, todayOrderCount: onSecondPage ? 2 : 0 },
            counts: { calculated: 50, excluded: 0 },
            pagination: { page: onSecondPage ? 2 : 1, perPage: 25, total: 50, totalPages: 2 },
          }),
        );
      }),
    );
    try {
      const { user } = renderPage(createTestQueryClient());
      expect(await screen.findByText(tOpenDay('finalizing'))).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: trMessages.common.pagination.nextPage }));
      await waitFor(() => expect(counts.list).toBe(2));

      // Page 2 is still loading: the previous page's open day keeps the notice up.
      expect(screen.getByText(tOpenDay('finalizing'))).toBeInTheDocument();
    } finally {
      releasePageTwo();
    }

    expect(await screen.findByText(tOpenDay('todayNotice'))).toBeInTheDocument();
    expect(screen.getByText(tOpenDay('finalizing'))).toBeInTheDocument();
  });

  it('the open-day-only empty state and notice do not blink when the cost-status tab changes', async () => {
    // The store's only orders are today's. The excluded tab is held until the
    // test releases it, so the swap is observable.
    let releaseExcluded = (): void => {};
    const excludedHeld = new Promise<void>((resolve) => {
      releaseExcluded = resolve;
    });
    const counts = { list: 0 };
    server.use(
      http.get(SUMMARY_URL, () => HttpResponse.json(summaryResponse())),
      http.get(LIST_URL, async ({ request }) => {
        counts.list += 1;
        if (new URL(request.url).searchParams.get('costStatus') === 'excluded') {
          await excludedHeld;
        }
        return HttpResponse.json(listResponse({ openDay: { todayOrderCount: 3 } }));
      }),
    );
    // The today line is said once, by the empty state inside the table, never
    // by the notice above it.
    const expectTodayPointerOnlyInTable = (): void => {
      const table = screen.getByRole('table');
      expect(within(table).getByText(trMessages.ordersPage.empty.openDayOnly)).toBeInTheDocument();
      expect(within(table).getByText(tOpenDay('todayNotice'))).toBeInTheDocument();
      expect(screen.getAllByText(tOpenDay('todayNotice'))).toHaveLength(1);
      expect(screen.getAllByRole('link', { name: tOpenDay('todayLink') })).toHaveLength(1);
    };
    const queryClient = createTestQueryClient();
    try {
      const { user } = renderPage(queryClient);
      expect(await screen.findByText(trMessages.ordersPage.empty.openDayOnly)).toBeInTheDocument();
      expectTodayPointerOnlyInTable(); // control

      await user.click(screen.getByText(trMessages.ordersPage.tabs.excluded));
      await waitFor(() => expect(counts.list).toBe(2));

      // The excluded tab is still loading. A tab change cannot make the store
      // less empty, so the screen stays as it was: no generic tab body, no
      // today line popping up above the table.
      expectTodayPointerOnlyInTable();
      expect(screen.queryByText(trMessages.ordersPage.excludedList.empty)).not.toBeInTheDocument();
    } finally {
      releaseExcluded();
    }
    await waitForIdle(queryClient);

    expectTodayPointerOnlyInTable();
  });

  it('the no-orders welcome does not show while a cleared search loads', async () => {
    // The unfiltered list is held until the test releases it.
    let releaseUnfiltered = (): void => {};
    const unfilteredHeld = new Promise<void>((resolve) => {
      releaseUnfiltered = resolve;
    });
    const counts = { list: 0 };
    server.use(
      http.get(SUMMARY_URL, () => HttpResponse.json(summaryResponse())),
      http.get(LIST_URL, async ({ request }) => {
        counts.list += 1;
        const searched = new URL(request.url).searchParams.has('q');
        if (!searched) await unfilteredHeld;
        return HttpResponse.json(
          listResponse({
            // Today has orders too, so the today line is on screen throughout.
            openDay: { todayOrderCount: 2 },
            counts: searched ? { calculated: 0, excluded: 0 } : { calculated: 50, excluded: 0 },
            pagination: searched
              ? { page: 1, perPage: 25, total: 0, totalPages: 0 }
              : { page: 1, perPage: 25, total: 50, totalPages: 2 },
          }),
        );
      }),
    );
    try {
      const { user } = renderPage(createTestQueryClient(), '?q=zzz');
      // The search's zero-row body is up before the search is cleared.
      expect(
        await screen.findByText(trMessages.ordersPage.tabs.emptyCalculated),
      ).toBeInTheDocument();
      // Control: a filtered view shows the today line above the table.
      expect(screen.getByText(tOpenDay('todayNotice'))).toBeInTheDocument();
      await user.click(
        screen.getByRole('button', { name: trMessages.common.dataTable.toolbar.clear }),
      );
      await waitFor(() => expect(counts.list).toBe(2));

      // The store has orders: the search's zero counts must not read as an empty store.
      expect(
        screen.queryByText(trMessages.ordersPage.empty.noOrders.title),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(trMessages.ordersPage.empty.openDayOnly)).not.toBeInTheDocument();
      // Nor does the search's "no results" body stand in: the table loads.
      expect(
        screen.queryByText(trMessages.ordersPage.tabs.emptyCalculated),
      ).not.toBeInTheDocument();
      // ...nor hide the today line while the unfiltered list loads.
      expect(screen.getByText(tOpenDay('todayNotice'))).toBeInTheDocument();
    } finally {
      releaseUnfiltered();
    }
  });

  it("a new search hides the previous search's today matches while it loads", async () => {
    const match: OpenDayMatch = {
      source: 'orders',
      id: '00000000-0000-0000-0000-0000000000a1',
      orderNumber: 'TY-TODAY-1',
      cancelled: false,
    };
    // The unfiltered list is held until the test releases it.
    let releaseUnfiltered = (): void => {};
    const unfilteredHeld = new Promise<void>((resolve) => {
      releaseUnfiltered = resolve;
    });
    const counts = { list: 0 };
    server.use(
      http.get(SUMMARY_URL, () => HttpResponse.json(summaryResponse())),
      http.get(LIST_URL, async ({ request }) => {
        counts.list += 1;
        const searched = new URL(request.url).searchParams.has('q');
        if (!searched) await unfilteredHeld;
        return HttpResponse.json(
          listResponse({
            openDay: { matches: searched ? [match] : [] },
            counts: { calculated: 50, excluded: 0 },
            pagination: { page: 1, perPage: 25, total: 50, totalPages: 2 },
          }),
        );
      }),
    );
    const matchLink = tOpenDay('matchStored', { orderNumber: match.orderNumber });
    try {
      const { user } = renderPage(createTestQueryClient(), `?q=${match.orderNumber}`);
      // Control: the search's own response offers its match.
      expect(await screen.findByRole('link', { name: matchLink })).toBeInTheDocument();

      await user.click(
        screen.getByRole('button', { name: trMessages.common.dataTable.toolbar.clear }),
      );
      await waitFor(() => expect(counts.list).toBe(2));

      // The cleared search is still loading: the old match is not offered for it.
      expect(screen.queryByRole('link', { name: matchLink })).not.toBeInTheDocument();
    } finally {
      releaseUnfiltered();
    }
  });
});

describe('OrdersPageClient - refresh triggers', () => {
  // 2026-07-08 12:00 Istanbul: mid-day, far from the day boundary, so neither
  // the rollover timer nor a date change can land inside a test.
  const MID_DAY = new Date('2026-07-08T09:00:00Z');

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(MID_DAY);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function advance(queryClient: QueryClient, ms: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
    await waitForIdle(queryClient);
  }

  async function waitForFirstLoad(counts: HandlerCounts, queryClient: QueryClient): Promise<void> {
    await waitFor(() => {
      expect(counts.list).toBe(1);
      expect(counts.summary).toBe(1);
    });
    await waitForIdle(queryClient);
  }

  it('refetches the list when a completed-day order id is published on the bus', async () => {
    const counts = serve(() => listResponse());
    const queryClient = createTestQueryClient();
    renderPage(queryClient);
    await waitForFirstLoad(counts, queryClient);
    // Control: nothing refetches on its own.
    await advance(queryClient, ORDERS_REALTIME_REFRESH_DEBOUNCE_MS);
    expect(counts.list).toBe(1);

    act(() => publishCompletedDayOrder('order-from-yesterday'));
    await advance(queryClient, ORDERS_REALTIME_REFRESH_DEBOUNCE_MS);

    expect(counts.list).toBe(2);
  });

  it('refetches list and summary at the day boundary', async () => {
    const businessDate = getBusinessDate(MID_DAY);
    const dayEnd = getBusinessDayRangeOfDate(businessDate).end.getTime();
    vi.setSystemTime(dayEnd - 3_000);
    // The handler names the business date of the moment it runs, so the refetch
    // after the boundary brings the next date and the rollover stops retrying.
    const counts = serve(() => listResponse());
    const queryClient = createTestQueryClient();
    renderPage(queryClient);
    await waitForFirstLoad(counts, queryClient);

    await advance(queryClient, 3_000 + ROLLOVER_GRACE_MS + 500);

    expect(counts.list).toBe(2);
    expect(counts.summary).toBe(2);
  });

  it('polls the summary while finalizing', async () => {
    const counts = serve(() => listResponse({ openDay: { finalizing: true } }));
    const queryClient = createTestQueryClient();
    renderPage(queryClient);
    await waitForFirstLoad(counts, queryClient);

    await advance(queryClient, POLL_STEP_MS);

    expect(counts.list).toBe(2);
    expect(counts.summary).toBeGreaterThanOrEqual(2);
  });

  it('refetches the summary once when finalizing turns false', async () => {
    let listServedFalse = false;
    const counts = serve(
      (call) => {
        const finalizing = call === 1;
        if (!finalizing) listServedFalse = true;
        return listResponse({ openDay: { finalizing } });
      },
      // The post-close figures exist only once the list has reported the close.
      () => summaryResponse(listServedFalse ? POST_CLOSE_PROFIT : PRE_CLOSE_PROFIT),
    );
    const queryClient = createTestQueryClient();
    renderPage(queryClient);
    await waitForFirstLoad(counts, queryClient);

    // The list poll reads finalizing: false.
    await advance(queryClient, POLL_STEP_MS);
    expect(listServedFalse).toBe(true);

    // Let the KPI count-up tween settle on its final frame.
    await advance(queryClient, COUNT_UP_DURATION_MS + 100);
    await waitFor(() =>
      expect(screen.getByText(formatCurrency(POST_CLOSE_PROFIT))).toBeInTheDocument(),
    );

    // Nothing polls any more.
    const settled = { ...counts };
    await advance(queryClient, POLL_STEP_MS);
    await advance(queryClient, POLL_STEP_MS);
    expect(counts).toEqual(settled);
  });

  it('refetches the summary when finalizing ends during a list query swap', async () => {
    // Page 1 is still finalizing, page 2 no longer is. Keyed on the page param
    // (not the call number) so a page-1 poll cannot report the end before the
    // swap. The page is part of the list key but not of the summary key, so the
    // summary fetches again only through the page's trailing refetch.
    const counts = serve((_call, url) => {
      const onSecondPage = url.searchParams.get('page') === '2';
      return listResponse({
        openDay: { finalizing: !onSecondPage },
        counts: { calculated: 50, excluded: 0 },
        pagination: { page: onSecondPage ? 2 : 1, perPage: 25, total: 50, totalPages: 2 },
      });
    });
    const queryClient = createTestQueryClient();
    const { user } = renderPage(queryClient);
    await waitForFirstLoad(counts, queryClient);
    const summaryBeforeSwap = counts.summary;

    // The list query swaps to page 2: page 1's data (finalizing: true) stays as
    // its placeholder until page 2 lands with finalizing: false.
    await user.click(screen.getByRole('button', { name: trMessages.common.pagination.nextPage }));
    await waitFor(() => expect(counts.summary).toBe(summaryBeforeSwap + 1));
    await waitForIdle(queryClient);

    expect(counts.list).toBe(2);
    expect(counts.summary).toBe(summaryBeforeSwap + 1);

    // Nothing polls any more.
    const settled = { ...counts };
    await advance(queryClient, POLL_STEP_MS);
    await advance(queryClient, POLL_STEP_MS);
    expect(counts).toEqual(settled);
  });

  it("a store switch does not carry the previous store's finalizing into a summary refetch", async () => {
    // Store 1 is finalizing, store 2 is not.
    const counts = serve(() => listResponse({ openDay: { finalizing: true } }));
    const otherStoreId = '00000000-0000-0000-0000-000000000003';
    const otherListUrl = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${otherStoreId}/orders`;
    const otherCounts: HandlerCounts = { list: 0, summary: 0 };
    server.use(
      http.get(`${otherListUrl}/summary`, () => {
        otherCounts.summary += 1;
        return HttpResponse.json(summaryResponse());
      }),
      http.get(otherListUrl, () => {
        otherCounts.list += 1;
        return HttpResponse.json(listResponse({ openDay: { finalizing: false } }));
      }),
    );
    const queryClient = createTestQueryClient();
    const view = renderPage(queryClient);
    await waitForFirstLoad(counts, queryClient);

    view.rerender(
      <OrdersPageClient
        orgId={ORG_ID}
        storeId={otherStoreId}
        pageTitle="orders-title"
        pageIntent="orders-intent"
      />,
    );
    await waitFor(() => {
      expect(otherCounts.list).toBe(1);
      expect(otherCounts.summary).toBe(1);
    });
    await waitForIdle(queryClient);

    // Store 2 never reported finalizing, so its summary is fetched once only.
    expect(otherCounts.summary).toBe(1);
  });

  it('the summary stops polling when the list poll cap is reached', async () => {
    const counts = serve(() => listResponse({ openDay: { finalizing: true } }));
    const queryClient = createTestQueryClient();
    renderPage(queryClient);
    await waitForFirstLoad(counts, queryClient);

    // Control: the summary polls before the cap.
    await advance(queryClient, POLL_STEP_MS);
    await advance(queryClient, POLL_STEP_MS);
    expect(counts.summary).toBeGreaterThanOrEqual(3);

    // Jump past the cap without firing timers. The cap is read when each
    // interval callback re-runs, so one more tick of each may still land.
    vi.setSystemTime(Date.now() + FINALIZING_POLL_MAX_MS);
    await advance(queryClient, POLL_STEP_MS);
    const atCap = { ...counts };

    await advance(queryClient, POLL_STEP_MS);
    await advance(queryClient, POLL_STEP_MS);
    expect(counts).toEqual(atCap);
  });

  it('a page change does not restart the poll cap', async () => {
    const counts = serve((_call, url) => {
      const onSecondPage = url.searchParams.get('page') === '2';
      return listResponse({
        openDay: { finalizing: true },
        counts: { calculated: 50, excluded: 0 },
        pagination: { page: onSecondPage ? 2 : 1, perPage: 25, total: 50, totalPages: 2 },
      });
    });
    const queryClient = createTestQueryClient();
    const { user } = renderPage(queryClient);
    await waitForFirstLoad(counts, queryClient);

    // Close to the cap (without firing timers), the seller moves to page 2.
    vi.setSystemTime(Date.now() + FINALIZING_POLL_MAX_MS - 3 * POLL_STEP_MS);
    await user.click(screen.getByRole('button', { name: trMessages.common.pagination.nextPage }));
    await waitFor(() => expect(counts.list).toBe(2));
    await waitForIdle(queryClient);

    // Control: page 2 still polls inside the window.
    await advance(queryClient, POLL_STEP_MS);
    expect(counts.list).toBe(3);

    // Past the window that opened on page 1. The cap is read when each interval
    // callback re-runs, so one more tick of each may still land.
    vi.setSystemTime(Date.now() + 3 * POLL_STEP_MS);
    await advance(queryClient, POLL_STEP_MS);
    const atCap = { ...counts };

    await advance(queryClient, POLL_STEP_MS);
    await advance(queryClient, POLL_STEP_MS);
    expect(counts).toEqual(atCap);
  });
});
