import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { OrderDetailModal } from '@/features/orders/components/order-detail-modal';

import trMessages from '../../../../messages/tr.json';
import { HttpResponse, http, server } from '../../../helpers/msw';
import { render, screen, within } from '../../../helpers/render';

// Turkish copy referenced through the catalog so this source file stays ASCII.
const kpis = trMessages.orderDetail.kpis;
const backToListLabel = trMessages.orderDetail.backToList;

vi.mock('next/navigation', () => ({ useRouter: vi.fn(() => ({ push: vi.fn() })) }));

const ORG = '11111111-1111-1111-1111-111111111111';
const STORE = '22222222-2222-2222-2222-222222222222';
const API = 'http://localhost:3001';

const selection = {
  id: 'ord-1',
  title: 'TY-12345',
  orderDate: '2026-06-20T10:00:00.000Z',
};

// Full backend-served ProfitBreakdown so OrderKpiGrid + ProfitBreakdownCard read
// real fields (margin comes from saleMarginPct — no frontend derivation).
const BREAKDOWN = {
  listGross: '200.00',
  sellerDiscountGross: '0.00',
  saleGross: '200.00',
  saleVat: '33.33',
  costGross: '100.00',
  costVat: '16.67',
  commissionGross: '20.00',
  commissionVat: '3.33',
  shippingGross: '0.00',
  shippingVat: '0.00',
  outboundShippingGross: '0.00',
  outboundShippingVat: '0.00',
  returnShippingGross: '0.00',
  returnShippingVat: '0.00',
  platformServiceGross: '0.00',
  platformServiceVat: '0.00',
  internationalServiceGross: '0.00',
  internationalServiceVat: '0.00',
  overseasReturnOperationGross: '0.00',
  overseasReturnOperationVat: '0.00',
  stoppage: '0.00',
  netVat: '13.33',
  netProfit: '31.00',
  saleMarginPct: '15.5',
  costMarkupPct: null,
};

// Minimal-but-complete order graph: empty items/fees/claims render their empty
// states, all delivery fields null (delivery section renders nothing), so the
// modal-chrome body renders cleanly around the dense KPI grid.
const ORDER = {
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
  micro: false,
  saleGross: '200.00',
  saleVat: '33.33',
  listGross: '200.00',
  estimatedNetProfit: '31.00',
  settledNetProfit: null,
  profitBreakdown: BREAKDOWN,
  promotionDisplays: null,
  profitExcludedAt: null,
  profitExclusionReason: null,
  reconciliationStatus: 'NOT_SETTLED',
  paymentOrderId: null,
  paymentDate: null,
  createdAt: '2026-06-20T10:00:00.000Z',
  updatedAt: '2026-06-20T10:00:00.000Z',
  items: [],
  fees: [],
  claims: [],
};

describe('OrderDetailModal', () => {
  it('renders nothing when no order is selected', () => {
    const { container } = render(
      <OrderDetailModal orgId={ORG} storeId={STORE} order={null} onClose={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the order title in the header and fires onClose on dismiss', async () => {
    // The detail body fetch is out of scope here — a 404 keeps OrderDetailClient
    // in a defined state while the header title (from the selection prop) and the
    // close affordance, which this test targets, render regardless.
    server.use(
      http.get(`${API}/v1/organizations/${ORG}/stores/${STORE}/orders/ord-1`, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Not Found', status: 404, code: 'NOT_FOUND' },
          { status: 404 },
        ),
      ),
    );
    const onClose = vi.fn();
    render(<OrderDetailModal orgId={ORG} storeId={STORE} order={selection} onClose={onClose} />);

    expect(await screen.findByText('TY-12345')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /kapat/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders the dense OrderKpiGrid and omits the framed page header in modal chrome', async () => {
    server.use(
      http.get(`${API}/v1/organizations/${ORG}/stores/${STORE}/orders/ord-1`, () =>
        HttpResponse.json(ORDER),
      ),
    );
    render(<OrderDetailModal orgId={ORG} storeId={STORE} order={selection} onClose={() => {}} />);

    // The sale KPI comes from OrderKpiGrid — the modal path's dense grid.
    const saleLabel = await screen.findByText(kpis.saleGross.label);

    // It is the DENSE grid (2-col, never widened to 4-col) — the page-path bare
    // StatStrip inside a framed PageHeader is not mounted in modal chrome.
    const grid = saleLabel.closest('.grid');
    expect(grid).not.toBeNull();
    expect(grid?.className).toContain('sm:grid-cols-2');
    expect(grid?.className).not.toContain('lg:grid-cols-4');

    // The other three KPI labels live in the SAME grid (scoped, since the profit
    // breakdown card repeats "estimated profit" elsewhere on the page).
    const gridScope = within(grid as HTMLElement);
    expect(gridScope.getByText(kpis.estimatedNetProfit.label)).toBeInTheDocument();
    expect(gridScope.getByText(kpis.settledNetProfit.label)).toBeInTheDocument();
    expect(gridScope.getByText(kpis.margin.label)).toBeInTheDocument();

    // No framed page header: the page-only back-to-list button is absent.
    expect(screen.queryByRole('button', { name: backToListLabel })).toBeNull();
  });
});
