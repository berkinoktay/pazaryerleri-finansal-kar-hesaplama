import { createTranslator } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import type { OrderDetail } from '@/features/orders/api/get-order.api';
import { OrderDetailClient } from '@/features/orders/components/order-detail-client';

import trMessages from '../../../../messages/tr.json';
import { HttpResponse, http, server } from '../../../helpers/msw';
import { render, screen } from '../../../helpers/render';

vi.mock('next/navigation', () => ({ useRouter: vi.fn(() => ({ push: vi.fn() })) }));

const ORG = '11111111-1111-1111-1111-111111111111';
const STORE = '22222222-2222-2222-2222-222222222222';
const API = 'http://localhost:3001';

// Turkish copy referenced through the catalog so this source file stays ASCII.
const BLOCKERS_TITLE = trMessages.profitBlockers.title;
const UNAVAILABLE = trMessages.profitBreakdown.unavailable;
const tBlockers = createTranslator({
  locale: 'tr',
  messages: trMessages,
  namespace: 'profitBlockers',
});

// A not-computable order: the API sends no breakdown and names the blockers.
const BLOCKED_ORDER: OrderDetail = {
  id: 'ord-1',
  organizationId: ORG,
  storeId: STORE,
  store: { id: STORE, name: 'Test Store', platform: 'TRENDYOL' },
  platformOrderId: 'p-ord-1',
  platformOrderNumber: 'TY-12345',
  orderDate: '2026-06-20T10:00:00.000Z',
  status: 'DELIVERED',
  agreedDeliveryDate: null,
  actualDeliveryDate: null,
  deliveredOnTime: null,
  fastDelivery: false,
  isExportSale: false,
  saleGross: '200.00',
  saleVat: '33.33',
  listGross: '200.00',
  estimatedNetProfit: null,
  settledNetProfit: null,
  profitBreakdown: null,
  profitIssues: [],
  profitBlockers: [
    { code: 'SHIPPING_ESTIMATE_UNAVAILABLE', detail: 'DESI_OVERFLOW' },
    { code: 'CARRIER_NOT_RECOGNIZED', detail: 'Alternative Delivery' },
  ],
  promotionDisplays: null,
  profitExcludedAt: null,
  profitExclusionReason: null,
  reconciliationStatus: 'NOT_SETTLED',
  createdAt: '2026-06-20T10:00:00.000Z',
  updatedAt: '2026-06-20T10:00:00.000Z',
  items: [],
  claims: [],
};

function serveOrder(order: OrderDetail): void {
  server.use(
    http.get(`${API}/v1/organizations/${ORG}/stores/${STORE}/orders/ord-1`, () =>
      HttpResponse.json(order),
    ),
  );
}

function renderDetail(): void {
  render(<OrderDetailClient orgId={ORG} storeId={STORE} orderId="ord-1" chrome="modal" />);
}

describe('OrderDetailClient - not-computable profit', () => {
  it('shows the blocker alert with every reason and drops the generic unavailable text', async () => {
    serveOrder(BLOCKED_ORDER);
    renderDetail();

    const title = await screen.findByText(BLOCKERS_TITLE);
    const alert = title.closest('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert).toHaveTextContent(
      tBlockers('reasons.SHIPPING_ESTIMATE_UNAVAILABLE.DESI_OVERFLOW'),
    );
    expect(alert).toHaveTextContent(
      tBlockers('reasons.CARRIER_NOT_RECOGNIZED', { providerName: 'Alternative Delivery' }),
    );
    expect(screen.queryByText(UNAVAILABLE)).toBeNull();
  });

  it('shows no blocker alert and keeps the unavailable text when there are no blockers', async () => {
    serveOrder({ ...BLOCKED_ORDER, profitBlockers: [] });
    renderDetail();

    expect((await screen.findAllByText(UNAVAILABLE)).length).toBeGreaterThan(0);
    expect(screen.queryByText(BLOCKERS_TITLE)).toBeNull();
  });
});
