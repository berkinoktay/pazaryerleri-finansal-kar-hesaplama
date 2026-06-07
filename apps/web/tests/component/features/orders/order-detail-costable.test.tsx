import { describe, expect, it, vi } from 'vitest';

import { OrderDetailCostable } from '@/features/orders/components/order-detail-costable';

import { http, HttpResponse, server } from '../../../helpers/msw';
import { render, screen } from '../../../helpers/render';

// OrderDetailClient calls useRouter() for back-nav; mirror the worklist test's
// app-router shim so the shared render helper (no Next AppRouterContext) works.
vi.mock('next/navigation', () => ({ useRouter: vi.fn(() => ({ push: vi.fn() })) }));

const ORG = '11111111-1111-1111-1111-111111111111';
const STORE = '22222222-2222-2222-2222-222222222222';
const ORDER = '33333333-3333-3333-3333-333333333333';
const TEST_API_BASE = 'http://localhost:3001';

function orderDetail(unitCostSnapshotNet: string | null) {
  return {
    id: ORDER,
    organizationId: ORG,
    storeId: STORE,
    store: { id: STORE, name: 'Mağaza', platform: 'TRENDYOL' },
    platformOrderId: '900',
    platformOrderNumber: 'ON-1',
    orderDate: '2026-04-15T14:30:00.000Z',
    status: 'DELIVERED',
    agreedDeliveryDate: null,
    actualDeliveryDate: null,
    deliveredOnTime: null,
    fastDelivery: false,
    micro: false,
    saleSubtotalNet: '200.00',
    saleVatTotal: '40.00',
    estimatedNetProfit: null,
    settledNetProfit: null,
    reconciliationStatus: 'NOT_SETTLED',
    paymentOrderId: null,
    paymentDate: null,
    createdAt: '2026-04-15T14:30:00.000Z',
    updatedAt: '2026-04-15T14:30:00.000Z',
    items: [
      {
        id: 'item-1',
        quantity: 1,
        unitPriceNet: '200.00',
        unitVatRate: '20',
        unitVatAmount: '40.00',
        grossCommissionAmountNet: '20.00',
        grossCommissionVatAmount: '4.00',
        refundedCommissionAmountNet: '0',
        refundedCommissionVatAmount: '0',
        sellerDiscountNet: '0',
        sellerDiscountVatAmount: '0',
        unitCostSnapshotNet,
        unitCostSnapshotVatRate: null,
        unitCostSnapshotVatAmount: null,
        commissionInvoiceSerialNumber: null,
        variant: {
          id: 'v1',
          barcode: '869',
          productName: 'Ürün',
          productImageUrl: null,
          marketplaceProductCode: 'SKU-1',
        },
      },
    ],
    fees: [],
    claims: [],
  };
}

describe('OrderDetailCostable', () => {
  it('renders the cost-entry trigger for a cost-missing item', async () => {
    server.use(
      http.get(`*/v1/organizations/${ORG}/stores/${STORE}/orders/${ORDER}`, () =>
        HttpResponse.json(orderDetail(null)),
      ),
      http.get(`${TEST_API_BASE}/v1/organizations/${ORG}/cost-profiles`, () =>
        HttpResponse.json({ data: [], meta: { nextCursor: null, hasMore: false } }),
      ),
    );

    render(<OrderDetailCostable orgId={ORG} storeId={STORE} orderId={ORDER} />);

    expect(
      await screen.findByRole('button', { name: /maliyet gir|enter cost/i }),
    ).toBeInTheDocument();
  });

  it('renders the read-only snapshot (no trigger) when the item is already costed', async () => {
    server.use(
      http.get(`*/v1/organizations/${ORG}/stores/${STORE}/orders/${ORDER}`, () =>
        HttpResponse.json(orderDetail('42.00')),
      ),
    );

    render(<OrderDetailCostable orgId={ORG} storeId={STORE} orderId={ORDER} />);

    await screen.findByText('ON-1');
    expect(
      screen.queryByRole('button', { name: /maliyet gir|enter cost/i }),
    ).not.toBeInTheDocument();
  });
});
