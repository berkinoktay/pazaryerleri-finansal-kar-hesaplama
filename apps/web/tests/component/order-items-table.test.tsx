import { describe, expect, it } from 'vitest';

import { formatCurrency } from '@pazarsync/utils';

import type { OrderItemDetail } from '@/features/orders/api/get-order.api';
import { OrderItemsTable } from '@/features/orders/components/order-items-table';

import { render, screen } from '../helpers/render';

function makeItem(overrides: Partial<OrderItemDetail> = {}): OrderItemDetail {
  return {
    id: 'i1',
    quantity: 1,
    lineSaleGross: '120.00',
    saleVatRate: '20.00',
    lineSellerDiscountGross: '0.00',
    commissionGross: '12.00',
    commissionVatRate: '20.00',
    refundedCommissionGross: '0.00',
    estimatedCommissionGross: '12.00',
    settledCommissionGross: null,
    unitCostSnapshotGross: null,
    unitCostSnapshotVatRate: null,
    commissionInvoiceSerialNumber: null,
    barcode: null,
    vendorMissing: false,
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
  it('renders GROSS column headers ("KDV dahil") and the served gross values, no per-item profit', () => {
    render(<OrderItemsTable items={[makeItem()]} />);
    // Kolon başlıkları KDV-dahil; "net" GEÇMEZ.
    const grossHeaders = screen.getAllByText(/KDV dahil/);
    expect(grossHeaders.length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText(/\(net\)/)).not.toBeInTheDocument();
    // Backend-servisli gross değerler render edilir (kâr/marj satırda YOK).
    expect(screen.getByText(formatCurrency('120.00'))).toBeInTheDocument();
    expect(screen.getByText(formatCurrency('12.00'))).toBeInTheDocument();
  });

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
