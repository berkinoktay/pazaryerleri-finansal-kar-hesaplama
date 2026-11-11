import { NuqsTestHarness } from '../../../helpers/nuqs';
import { describe, expect, it } from 'vitest';

import { LiveOrdersTable } from '@/features/live-performance/components/live-orders-table';

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
  counts: { all: 3, calculated: 1, pending: 2 },
};

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
});
