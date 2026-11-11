import { describe, expect, it } from 'vitest';

import { formatCurrency } from '@pazarsync/utils';

import type { OrderItemDetail } from '@/features/orders/api/get-order.api';
import { OrderItemsList } from '@/features/orders/components/order-items-list';
import { EM_DASH } from '@/lib/format-percent';

import trMessages from '../../../../messages/tr.json';
import { render, screen, within } from '../../../helpers/render';

// Turkish copy referenced through the catalog so this source file stays ASCII.
const commissionAmountLabel = trMessages.orderDetail.items.meta.commissionAmount;
const commissionRateLabel = trMessages.orderDetail.items.meta.commissionRate;

function makeItem(overrides: Partial<OrderItemDetail> = {}): OrderItemDetail {
  return {
    id: 'i1',
    quantity: 1,
    lineSaleGross: '120.00',
    saleVatRate: '20.00',
    lineSellerDiscountGross: '0.00',
    commissionGross: '12.00',
    commissionRate: '20.00',
    commissionVatRate: '20.00',
    refundedCommissionGross: '0.00',
    estimatedCommissionGross: '12.00',
    settledCommissionGross: null,
    unitCostSnapshotGross: null,
    unitCostSnapshotVatRate: null,
    barcode: null,
    vendorMissing: false,
    variant: {
      id: 'v1',
      barcode: '8690000000000',
      productName: 'Test product',
      productImageUrl: null,
      marketplaceProductCode: 'SKU-1',
    },
    ...overrides,
  };
}

/** The meta cell (label + value) that carries the given label. */
function metaCell(label: string): HTMLElement {
  const cell = screen.getByText(label).parentElement;
  if (cell === null) throw new Error(`No meta cell for label: ${label}`);
  return cell;
}

describe('OrderItemsList', () => {
  it('renders the served commission amount', () => {
    render(<OrderItemsList items={[makeItem()]} />);
    expect(
      within(metaCell(commissionAmountLabel)).getByText(formatCurrency('12.00')),
    ).toBeInTheDocument();
  });

  it('shows an em dash, not a zero, when the profit part is empty (null commission)', () => {
    render(
      <OrderItemsList
        items={[
          makeItem({
            commissionGross: null,
            commissionRate: null,
            commissionVatRate: null,
            refundedCommissionGross: null,
          }),
        ]}
      />,
    );
    expect(within(metaCell(commissionAmountLabel)).getByText(EM_DASH)).toBeInTheDocument();
    expect(within(metaCell(commissionRateLabel)).getByText(EM_DASH)).toBeInTheDocument();
    expect(screen.queryByText(formatCurrency('0.00'))).not.toBeInTheDocument();
  });
});
