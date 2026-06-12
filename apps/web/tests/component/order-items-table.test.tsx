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
    // BOTH barcodes present — locks the precedence (variant ?? item, not the
    // reverse): the line-level barcode must NOT replace the catalog identity.
    render(<OrderItemsTable items={[makeItem({ barcode: '8680000000001' })]} />);
    expect(screen.queryByText('Eşleşme bekliyor')).not.toBeInTheDocument();
    expect(screen.getByText('8690000000000')).toBeInTheDocument();
    expect(screen.queryByText('8680000000001')).not.toBeInTheDocument();
    expect(screen.getByText('Test Ürünü — M')).toBeInTheDocument();
  });

  it('kâr-dışı siparişte maliyet hücresi "Kâr hesabı dışı" gösterir (uyarı değil)', () => {
    render(<OrderItemsTable items={[makeItem()]} profitExcluded />);
    expect(screen.getByText('Kâr hesabı dışı')).toBeInTheDocument();
    expect(screen.queryByText('Maliyet eksik')).not.toBeInTheDocument();
  });

  it('normal siparişte maliyetsiz kalem "Maliyet eksik" uyarısını korur', () => {
    render(<OrderItemsTable items={[makeItem()]} />);
    expect(screen.getByText('Maliyet eksik')).toBeInTheDocument();
    expect(screen.queryByText('Kâr hesabı dışı')).not.toBeInTheDocument();
  });
});
