import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { OrdersTable } from '@/features/orders/components/orders-table';

import messages from '../../../../messages/tr.json';
import { FORMATS } from '../../../../src/i18n/formats';

vi.mock('next/navigation', () => ({ useRouter: vi.fn(() => ({ push: vi.fn() })) }));

const baseRow = {
  id: 'o1',
  platformOrderId: '900',
  platformOrderNumber: 'ON-1',
  orderDate: '2026-04-15T14:30:00.000Z',
  status: 'DELIVERED' as const,
  reconciliationStatus: 'NOT_SETTLED' as const,
  saleGross: '240.00',
  saleVat: '40.00',
  listGross: '240.00',
  estimatedNetProfit: null,
  settledNetProfit: null,
  saleMarginPct: null,
  promotionDisplays: null,
  fastDelivery: false,
  micro: false,
  itemCount: 2,
};

function renderTable(costStatus: 'calculated' | 'excluded'): void {
  render(
    <NextIntlClientProvider
      locale="tr"
      messages={messages}
      formats={FORMATS}
      timeZone="Europe/Istanbul"
    >
      <OrdersTable
        rows={[baseRow]}
        pagination={{ page: 1, perPage: 25, total: 1, totalPages: 1 }}
        filters={{ q: '', status: null, reconciliationStatus: null, from: '', to: '' }}
        costStatus={costStatus}
        sort="-orderDate"
        counts={{ calculated: 1, excluded: 1 }}
        onCostStatusChange={vi.fn()}
        onFiltersChange={vi.fn()}
        onPaginationChange={vi.fn()}
        onSortChange={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

describe('OrdersTable segments', () => {
  it('excluded segment shows the info label (no CTA) and omits the profit column', () => {
    renderTable('excluded');
    expect(screen.getByText(messages.ordersPage.excludedList.label)).toBeInTheDocument();
    // Bilgilendirme segmenti — eski iş-listesi CTA'sı yok (spec 2026-06-12 K2).
    expect(screen.queryByText('Maliyet Ekle')).toBeNull();
    expect(screen.queryByText(messages.ordersPage.table.columns.estimatedNetProfit)).toBeNull();
  });

  it('calculated segment shows the estimated-profit column header', () => {
    renderTable('calculated');
    expect(
      screen.getByText(messages.ordersPage.table.columns.estimatedNetProfit),
    ).toBeInTheDocument();
  });
});
