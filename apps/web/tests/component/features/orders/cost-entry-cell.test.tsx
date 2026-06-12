import { describe, expect, it } from 'vitest';

import { CostEntryCell } from '@/features/orders/components/cost-entry-cell';
import type { OrderItemDetail } from '@/features/orders/api/get-order.api';

import { http, HttpResponse, server } from '../../../helpers/msw';
import { render, screen } from '../../../helpers/render';

const ORG = '11111111-1111-1111-1111-111111111111';
const STORE = '22222222-2222-2222-2222-222222222222';
const ORDER = '44444444-4444-4444-4444-444444444444';
const TEST_API_BASE = 'http://localhost:3001';

function itemFixture(over: Partial<OrderItemDetail> = {}): OrderItemDetail {
  return {
    id: 'item-1',
    quantity: 1,
    unitPriceNet: '100.00',
    unitVatRate: null,
    unitVatAmount: null,
    grossCommissionAmountNet: '0.00',
    grossCommissionVatAmount: '0.00',
    refundedCommissionAmountNet: '0.00',
    refundedCommissionVatAmount: '0.00',
    sellerDiscountNet: '0.00',
    sellerDiscountVatAmount: '0.00',
    unitCostSnapshotNet: null,
    unitCostSnapshotVatRate: null,
    unitCostSnapshotVatAmount: null,
    commissionInvoiceSerialNumber: null,
    barcode: null,
    variant: {
      id: 'v1',
      barcode: 'BC-1',
      productName: 'Tee',
      productImageUrl: null,
      marketplaceProductCode: null,
    },
    ...over,
  } as OrderItemDetail;
}

describe('CostEntryCell', () => {
  it('shows the read-only cost when already costed', () => {
    render(
      <CostEntryCell
        orgId={ORG}
        storeId={STORE}
        orderId={ORDER}
        item={itemFixture({ unitCostSnapshotNet: '42.00' })}
      />,
    );
    expect(
      screen.queryByRole('button', { name: /maliyet gir|enter cost/i }),
    ).not.toBeInTheDocument();
  });

  it('submits a manual cost', async () => {
    let received: unknown = null;

    server.use(
      http.get(`${TEST_API_BASE}/v1/organizations/${ORG}/cost-profiles`, () =>
        HttpResponse.json({ data: [], meta: { nextCursor: null, hasMore: false } }),
      ),
      http.patch(`*/orders/${ORDER}/items/item-1/cost`, async ({ request }) => {
        received = await request.json();
        return HttpResponse.json(
          {
            id: ORDER,
            platformOrderId: 'p1',
            platformOrderNumber: 'TY-1',
            orderDate: '2026-06-05T08:00:00.000Z',
            status: 'DELIVERED',
            reconciliationStatus: 'UNRECONCILED',
            saleSubtotalNet: '100.00',
            saleVatTotal: '20.00',
            estimatedNetProfit: null,
            store: { id: STORE, name: 'Test Store', platform: 'TRENDYOL' },
            items: [],
            fees: [],
            claims: [],
          },
          { status: 200 },
        );
      }),
    );

    const { user } = render(
      <CostEntryCell orgId={ORG} storeId={STORE} orderId={ORDER} item={itemFixture()} />,
    );

    await user.click(screen.getByRole('button', { name: /maliyet gir|enter cost/i }));
    // Use the specific label for the net-amount input (id="cost-net")
    // "Tutar (KDV haric)" is the label text -- use the input's id to be unambiguous
    await user.type(screen.getByRole('textbox', { name: /tutar \(kdv/i }), '42');
    await user.click(screen.getByRole('button', { name: /kaydet|save/i }));

    await screen.findByRole('button', { name: /maliyet gir|enter cost/i });
    expect(received).toMatchObject({ source: 'manual', netAmount: '42' });
  });

  it('shows noProfiles empty state in the profile tab when there are no profiles', async () => {
    server.use(
      http.get(`${TEST_API_BASE}/v1/organizations/${ORG}/cost-profiles`, () =>
        HttpResponse.json({ data: [], meta: { nextCursor: null, hasMore: false } }),
      ),
    );

    const { user } = render(
      <CostEntryCell orgId={ORG} storeId={STORE} orderId={ORDER} item={itemFixture()} />,
    );

    await user.click(screen.getByRole('button', { name: /maliyet gir|enter cost/i }));
    // Switch to the profile tab. The tab label comes from tr.json:
    // orderDetail.costEntry.tabs.profile = "Kayitli profil"
    const profileTab = await screen.findByRole('tab', { name: /profil/i });
    await user.click(profileTab);

    // noProfiles text from tr.json: "Kayitli maliyet profili yok"
    expect(
      await screen.findByText(/maliyet profili yok|no saved cost profiles/i),
    ).toBeInTheDocument();
  });
});
