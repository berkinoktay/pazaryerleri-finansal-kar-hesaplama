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
const BREAKDOWN_TITLE = trMessages.profitBreakdown.title;
const MICRO_EXPORT = trMessages.profitBreakdown.microExport;
// Rendered only by the profit hero (the summary card never prints it).
const HERO_LABEL = trMessages.profitBreakdown.estimatedProfit;
const COST_GROUP = trMessages.profitBreakdown.groups.cost;
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

// A consistent backend-served breakdown (the four groups close to saleGross).
const BREAKDOWN: NonNullable<OrderDetail['profitBreakdown']> = {
  listGross: '1159.70',
  sellerDiscountGross: '150.00',
  saleGross: '1009.70',
  saleVat: '168.28',
  costGross: '407.00',
  costVat: '67.83',
  commissionGross: '201.23',
  commissionVat: '33.54',
  shippingGross: '54.99',
  shippingVat: '9.16',
  outboundShippingGross: '54.99',
  outboundShippingVat: '9.16',
  returnShippingGross: '0.00',
  returnShippingVat: '0.00',
  platformServiceGross: '10.19',
  platformServiceVat: '1.70',
  internationalServiceGross: '0.00',
  internationalServiceVat: '0.00',
  overseasReturnOperationGross: '0.00',
  overseasReturnOperationVat: '0.00',
  stoppage: '8.41',
  netVat: '56.05',
  netProfit: '271.83',
  saleMarginPct: '26.92',
  costMarkupPct: '66.79',
  marketplaceFeesGross: '266.41',
  taxesGross: '64.46',
  totalDeductionsGross: '737.87',
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
    // Not an export order: no empty, header-only breakdown card is left behind.
    expect(screen.queryByText(BREAKDOWN_TITLE)).toBeNull();
  });

  it('shows no blocker alert and keeps the unavailable text when there are no blockers', async () => {
    serveOrder({ ...BLOCKED_ORDER, profitBlockers: [] });
    renderDetail();

    expect((await screen.findAllByText(UNAVAILABLE)).length).toBeGreaterThan(0);
    expect(screen.queryByText(BLOCKERS_TITLE)).toBeNull();
  });

  it('keeps the breakdown card header with the micro-export badge for a blocked export order', async () => {
    // A missing export return tier blocks exactly the micro-export orders, so the
    // badge must survive the not-computable state; only the generic text goes.
    serveOrder({
      ...BLOCKED_ORDER,
      isExportSale: true,
      profitBlockers: [{ code: 'REFERENCE_DATA_MISSING', detail: 'EXPORT_RETURN_TIER' }],
    });
    renderDetail();

    const title = await screen.findByText(BLOCKERS_TITLE);
    expect(title.closest('[role="alert"]')).toHaveTextContent(
      tBlockers('reasons.REFERENCE_DATA_MISSING.EXPORT_RETURN_TIER'),
    );
    expect(screen.getByText(BREAKDOWN_TITLE)).toBeInTheDocument();
    expect(screen.getByText(MICRO_EXPORT)).toBeInTheDocument();
    expect(screen.queryByText(UNAVAILABLE)).toBeNull();
  });

  it('never hides the profit cards when a breakdown arrives alongside blockers', async () => {
    // Defensive: the API should not send both, but a breakdown is always shown.
    serveOrder({
      ...BLOCKED_ORDER,
      estimatedNetProfit: BREAKDOWN.netProfit,
      profitBreakdown: BREAKDOWN,
    });
    renderDetail();

    expect(await screen.findByText(BLOCKERS_TITLE)).toBeInTheDocument();
    expect(screen.getByText(HERO_LABEL)).toBeInTheDocument();
    expect(screen.getByText(BREAKDOWN_TITLE)).toBeInTheDocument();
    expect(screen.getByText(COST_GROUP)).toBeInTheDocument();
    expect(screen.queryByText(UNAVAILABLE)).toBeNull();
  });
});
