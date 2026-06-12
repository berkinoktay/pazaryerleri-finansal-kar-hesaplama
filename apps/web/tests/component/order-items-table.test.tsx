import { describe, expect, it } from 'vitest';

import type { OrderItemDetail } from '@/features/orders/api/get-order.api';
import { OrderItemsTable } from '@/features/orders/components/order-items-table';

import { render, screen } from '../helpers/render';

function makeItem(overrides: Partial<OrderItemDetail> = {}): OrderItemDetail {
  return {
    id: 'i1',
    quantity: 1,
    unitPriceNet: '100.00',
    unitVatRate: '20.00',
    unitVatAmount: '20.00',
    grossCommissionAmountNet: '10.00',
    grossCommissionVatAmount: '2.00',
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
      barcode: '8690000000000',
      productName: 'Test Ürünü — M',
      productImageUrl: null,
      marketplaceProductCode: 'SKU-1',
    },
    ...overrides,
  };
}

describe('OrderItemsTable', () => {
  it('shows the unmatched badge and the line barcode when the item has no variant', () => {
    render(<OrderItemsTable items={[makeItem({ variant: null, barcode: '8680000000001' })]} />);
    expect(screen.getByText('Eşleşme bekliyor')).toBeInTheDocument();
    expect(screen.getByText('8680000000001')).toBeInTheDocument();
  });

  it('shows neither badge nor fallback barcode for a matched item (variant barcode wins)', () => {
    render(<OrderItemsTable items={[makeItem()]} />);
    expect(screen.queryByText('Eşleşme bekliyor')).not.toBeInTheDocument();
    expect(screen.getByText('8690000000000')).toBeInTheDocument();
    expect(screen.getByText('Test Ürünü — M')).toBeInTheDocument();
  });
});
