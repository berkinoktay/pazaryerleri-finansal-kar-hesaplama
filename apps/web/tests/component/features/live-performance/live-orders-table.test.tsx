import { describe, expect, it } from 'vitest';

import { LiveOrdersTable } from '@/features/live-performance/components/live-orders-table';

import { render, screen, waitFor } from '../../../helpers/render';
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
  total: 2,
  counts: { all: 2, calculated: 1, pending: 1 },
};

describe('LiveOrdersTable', () => {
  it('renders the union feed with calculated / pending status badges and tab counts', async () => {
    server.use(http.get(ORDERS_URL, () => HttpResponse.json(response)));

    render(<LiveOrdersTable orgId={ORG_ID} storeId={STORE_ID} />);

    await waitFor(() => expect(screen.getByText('TY-1001')).toBeInTheDocument());
    // Status badges from `source`: orders → Hesaplandı, buffer → Bekliyor
    expect(screen.getByText('Hesaplandı')).toBeInTheDocument();
    expect(screen.getByText('Bekliyor')).toBeInTheDocument();
    // Tab labels carry the per-tab counts from `counts`.
    expect(screen.getByRole('tab', { name: 'Tümü (2)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Hesaplanmış (1)' })).toBeInTheDocument();
  });

  it('refetches with filter=pending when the Bekliyor tab is selected', async () => {
    let lastFilter: string | null = null;
    server.use(
      http.get(ORDERS_URL, ({ request }) => {
        lastFilter = new URL(request.url).searchParams.get('filter');
        return HttpResponse.json(response);
      }),
    );

    const { user } = render(<LiveOrdersTable orgId={ORG_ID} storeId={STORE_ID} />);

    await waitFor(() => expect(screen.getByText('TY-1001')).toBeInTheDocument());

    await user.click(screen.getByRole('tab', { name: 'Bekliyor (1)' }));

    await waitFor(() => expect(lastFilter).toBe('pending'));
  });
});
