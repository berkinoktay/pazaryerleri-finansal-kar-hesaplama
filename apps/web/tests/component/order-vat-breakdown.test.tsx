import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { formatCurrency } from '@pazarsync/utils';

import type { OrderDetail, OrderItemDetail } from '@/features/orders/api/get-order.api';
import { OrderVatBreakdown } from '@/features/orders/components/order-vat-breakdown';

import { render, screen } from '../helpers/render';

function makeItem(overrides: Partial<OrderItemDetail> = {}): OrderItemDetail {
  return {
    id: 'i1',
    quantity: 1,
    unitPriceNet: '125.00',
    unitVatRate: '10.00',
    unitVatAmount: '12.50',
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
      barcode: '8690000000000',
      productName: 'Test Ürünü',
      productImageUrl: null,
      marketplaceProductCode: 'SKU-1',
    },
    ...overrides,
  };
}

type VatBreakdownOrder = Pick<OrderDetail, 'saleSubtotalNet' | 'saleVatTotal' | 'items'>;

function makeOrder(overrides: Partial<VatBreakdownOrder> = {}): VatBreakdownOrder {
  return {
    saleSubtotalNet: '125.00',
    saleVatTotal: '12.50',
    items: [makeItem()],
    ...overrides,
  };
}

describe('OrderVatBreakdown — şeffaf satış (denetim #1)', () => {
  it('satıcı indirimi varsa Liste → Satıcı indirimi → Net satış 3-satır bloğu gösterir', () => {
    // saleSubtotalNet ZATEN effectiveSale (125). Liste = 125 + indirim(41,67) = 166,67.
    render(
      <OrderVatBreakdown
        order={makeOrder({
          items: [makeItem({ sellerDiscountNet: '41.67', sellerDiscountVatAmount: '8.33' })],
        })}
      />,
    );
    expect(screen.getByText('Liste fiyatı (net)')).toBeInTheDocument();
    expect(screen.getByText('Satıcı indirimi (net)')).toBeInTheDocument();
    expect(screen.getByText('Net satış (net)')).toBeInTheDocument();
    // İndirim varken sade "Satış (net)" satırı görünmez (Net satış'a dönüşür) → çift-sayım izlenimi yok.
    expect(screen.queryByText('Satış (net)')).not.toBeInTheDocument();
    // Reconstrüksiyon matematiği: Liste = Net satış (125) + Satıcı indirimi (41,67) = 166,67.
    expect(screen.getByText(formatCurrency(new Decimal('166.67')))).toBeInTheDocument();
    expect(screen.getByText(formatCurrency(new Decimal('125')))).toBeInTheDocument();
  });

  it('satıcı indirimi yoksa tek sade "Satış (net)" satırı (gürültüsüz)', () => {
    render(<OrderVatBreakdown order={makeOrder()} />);
    expect(screen.getByText('Satış (net)')).toBeInTheDocument();
    expect(screen.queryByText('Liste fiyatı (net)')).not.toBeInTheDocument();
    expect(screen.queryByText('Net satış (net)')).not.toBeInTheDocument();
  });
});
