import { NuqsTestHarness } from '../../../helpers/nuqs';
import { describe, expect, it } from 'vitest';

import { OrderStatus } from '@pazarsync/db/enums';

import { LiveOrdersTable } from '@/features/live-performance/components/live-orders-table';

import trMessages from '../../../../messages/tr.json';
import { render, screen, waitFor, within } from '../../../helpers/render';
import { server, http, HttpResponse } from '../../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const STORE_ID = '00000000-0000-0000-0000-000000000002';
const ORDERS_URL = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/live-performance/orders`;

const response = {
  data: [
    {
      source: 'orders',
      platformOrderId: 'po-1',
      platformOrderNumber: 'TY-1001',
      orderDate: '2026-05-28T09:30:00Z',
      status: 'Created',
      revenue: '300.00',
      profit: '80.00',
      margin: '26.67',
    },
    {
      // An order whose profit is not computed yet: listed by the API under pending.
      source: 'orders',
      platformOrderId: 'po-3',
      platformOrderNumber: 'TY-1003',
      orderDate: '2026-05-28T10:45:00Z',
      status: 'Created',
      revenue: '75.00',
      profit: null,
      margin: null,
    },
    {
      source: 'buffer',
      platformOrderId: 'po-2',
      platformOrderNumber: null,
      orderDate: '2026-05-28T10:15:00Z',
      status: 'Created',
      revenue: '150.00',
      profit: null,
      margin: null,
    },
  ],
  total: 3,
  counts: { all: 3, calculated: 1, pending: 2, cancelled: 1 },
};

// Today's cancelled order: served only on the cancelled tab, without a profit.
const cancelledResponse = {
  data: [
    {
      source: 'orders',
      orderId: '00000000-0000-0000-0000-0000000000c1',
      platformOrderId: 'po-can-1',
      platformOrderNumber: 'TY-CAN-1',
      orderDate: '2026-05-28T11:00:00Z',
      status: OrderStatus.CANCELLED,
      revenue: '120.00',
      profit: null,
      margin: null,
    },
  ],
  total: 1,
  counts: response.counts,
};

// Copy comes from the catalog, never a literal: the Turkish values will change.
const tOrders = trMessages.livePerformance.orders;

/** Accessible-name matcher for a tab whose name also carries its count chip. */
function nameContains(label: string): (accessibleName: string) => boolean {
  return (accessibleName) => accessibleName.includes(label);
}

/** Serves the cancelled feed for filter=cancelled and records every requested filter. */
function serveByFilter(): { filters: (string | null)[] } {
  const seen: { filters: (string | null)[] } = { filters: [] };
  server.use(
    http.get(ORDERS_URL, ({ request }) => {
      const filter = new URL(request.url).searchParams.get('filter');
      seen.filters.push(filter);
      return HttpResponse.json(filter === 'cancelled' ? cancelledResponse : response);
    }),
  );
  return seen;
}

/** The table row that shows the given order number. */
function rowOf(orderNumber: string): HTMLElement {
  const row = screen.getByText(orderNumber).closest('tr');
  if (row === null) throw new Error(`no table row for ${orderNumber}`);
  return row;
}

describe('LiveOrdersTable', () => {
  it('renders the union feed with calculated / pending status badges and tab counts', async () => {
    server.use(http.get(ORDERS_URL, () => HttpResponse.json(response)));

    render(
      <NuqsTestHarness>
        <LiveOrdersTable orgId={ORG_ID} storeId={STORE_ID} />
      </NuqsTestHarness>,
    );

    await waitFor(() => expect(screen.getByText('TY-1001')).toBeInTheDocument());
    // Status badges follow the served profit (scoped to the table, since "Bekliyor" is
    // also a tab label): a row with a profit is Hesaplandı; a row without one -- a buffer
    // entry or an order whose profit is not computed yet -- is Bekliyor.
    const table = screen.getByRole('table');
    expect(within(table).getAllByText('Hesaplandı')).toHaveLength(1);
    expect(within(table).getAllByText('Bekliyor')).toHaveLength(2);
    expect(within(rowOf('TY-1001')).getByText('Hesaplandı')).toBeInTheDocument();
    expect(within(rowOf('TY-1003')).getByText('Bekliyor')).toBeInTheDocument();
    // FilterTabs render the per-tab count from `counts` as a separate chip.
    expect(within(screen.getByRole('tab', { name: /Tümü/ })).getByText('3')).toBeInTheDocument();
    expect(
      within(screen.getByRole('tab', { name: /Hesaplanmış/ })).getByText('1'),
    ).toBeInTheDocument();
  });

  it('refetches with filter=pending when the Bekliyor tab is selected', async () => {
    let lastFilter: string | null = null;
    server.use(
      http.get(ORDERS_URL, ({ request }) => {
        lastFilter = new URL(request.url).searchParams.get('filter');
        return HttpResponse.json(response);
      }),
    );

    const { user } = render(
      <NuqsTestHarness>
        <LiveOrdersTable orgId={ORG_ID} storeId={STORE_ID} />
      </NuqsTestHarness>,
    );

    await waitFor(() => expect(screen.getByText('TY-1001')).toBeInTheDocument());

    await user.click(screen.getByRole('tab', { name: /Bekliyor/ }));

    await waitFor(() => expect(lastFilter).toBe('pending'));
  });

  it('shows the cancelled tab with its count', async () => {
    serveByFilter();

    render(
      <NuqsTestHarness>
        <LiveOrdersTable orgId={ORG_ID} storeId={STORE_ID} />
      </NuqsTestHarness>,
    );

    await waitFor(() => expect(screen.getByText('TY-1001')).toBeInTheDocument());
    const cancelledTabName = nameContains(tOrders.tabs.cancelled);
    expect(screen.queryByRole('tab', { name: cancelledTabName })).toBeInTheDocument();
    expect(
      within(screen.getByRole('tab', { name: cancelledTabName })).getByText('1'),
    ).toBeInTheDocument();
  });

  it('refetches with filter=cancelled when the tab is selected and badges the row as cancelled', async () => {
    const seen = serveByFilter();

    const { user } = render(
      <NuqsTestHarness>
        <LiveOrdersTable orgId={ORG_ID} storeId={STORE_ID} />
      </NuqsTestHarness>,
    );

    await waitFor(() => expect(screen.getByText('TY-1001')).toBeInTheDocument());
    const cancelledTab = screen.queryByRole('tab', { name: nameContains(tOrders.tabs.cancelled) });
    expect(cancelledTab).toBeInTheDocument();
    if (cancelledTab === null) return;

    await user.click(cancelledTab);

    await waitFor(() => expect(seen.filters.at(-1)).toBe('cancelled'));
    await waitFor(() => expect(screen.getByText('TY-CAN-1')).toBeInTheDocument());
    const row = rowOf('TY-CAN-1');
    expect(within(row).getByText(tOrders.statusCancelled)).toBeInTheDocument();
    expect(within(row).queryByText(tOrders.statusPending)).not.toBeInTheDocument();
  });

  it('opens on the cancelled tab from ?ordersFilter=cancelled', async () => {
    const seen = serveByFilter();

    render(
      <NuqsTestHarness initialSearchParams="?ordersFilter=cancelled">
        <LiveOrdersTable orgId={ORG_ID} storeId={STORE_ID} />
      </NuqsTestHarness>,
    );

    await waitFor(() => expect(seen.filters.length).toBeGreaterThan(0));
    // The first request already asks for the cancelled feed (no detour via "all").
    expect(seen.filters[0]).toBe('cancelled');
    await waitFor(() => expect(screen.getByText('TY-CAN-1')).toBeInTheDocument());
    expect(screen.getByRole('tab', { name: nameContains(tOrders.tabs.cancelled) })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('shows the cancelled empty title when there are none', async () => {
    const seen: { filters: (string | null)[] } = { filters: [] };
    server.use(
      http.get(ORDERS_URL, ({ request }) => {
        seen.filters.push(new URL(request.url).searchParams.get('filter'));
        return HttpResponse.json({
          data: [],
          total: 0,
          counts: { all: 0, calculated: 0, pending: 0, cancelled: 0 },
        });
      }),
    );

    render(
      <NuqsTestHarness initialSearchParams="?ordersFilter=cancelled">
        <LiveOrdersTable orgId={ORG_ID} storeId={STORE_ID} />
      </NuqsTestHarness>,
    );

    await waitFor(() => expect(seen.filters.length).toBeGreaterThan(0));
    await waitFor(() =>
      expect(screen.queryByText(tOrders.emptyCancelledTitle)).toBeInTheDocument(),
    );
    expect(screen.queryByText(tOrders.emptyTitle)).not.toBeInTheDocument();
  });
});
