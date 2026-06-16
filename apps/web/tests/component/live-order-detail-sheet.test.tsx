import { describe, expect, it } from 'vitest';

import { LiveOrderDetailSheet } from '@/features/live-performance/components/live-order-detail-sheet';
import type { LiveOrderRow } from '@/features/live-performance/api/get-live-orders.api';

import { http, HttpResponse, server } from '../helpers/msw';
import { render, screen } from '../helpers/render';

const ORG = '11111111-1111-1111-1111-111111111111';
const STORE = '22222222-2222-2222-2222-222222222222';
const TEST_API_BASE = 'http://localhost:3001';

const bufferRow: LiveOrderRow = {
  source: 'buffer',
  platformOrderId: 'p1',
  platformOrderNumber: 'TY-1',
  orderDate: '2026-06-05T08:00:00.000Z',
  status: 'PENDING',
  revenue: '200.00',
  profit: null,
  margin: null,
  orderId: null,
  bufferId: 'buf-1',
};

describe('LiveOrderDetailSheet', () => {
  it('renders buffer detail for a buffer row', async () => {
    server.use(
      http.get(
        `${TEST_API_BASE}/v1/organizations/${ORG}/stores/${STORE}/live-performance/buffer/buf-1`,
        () =>
          HttpResponse.json({
            platformOrderNumber: 'TY-1',
            orderDate: '2026-06-05T08:00:00.000Z',
            status: 'PENDING',
            saleGross: '240.00',
            lines: [
              {
                barcode: 'BC-1',
                productName: 'Tisort',
                thumbUrl: null,
                variantId: null,
                stockCode: null,
                quantity: 2,
                lineSaleGross: '240.00',
              },
            ],
          }),
      ),
    );
    render(
      <LiveOrderDetailSheet orgId={ORG} storeId={STORE} selected={bufferRow} onClose={() => {}} />,
    );
    expect(await screen.findByText('Tisort')).toBeInTheDocument();
  });

  it('renders nothing when selected is null', () => {
    const { container } = render(
      <LiveOrderDetailSheet orgId={ORG} storeId={STORE} selected={null} onClose={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
