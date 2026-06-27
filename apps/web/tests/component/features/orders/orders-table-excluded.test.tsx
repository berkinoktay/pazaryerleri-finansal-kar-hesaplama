import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { OrderListItem } from '@/features/orders/api/list-orders.api';
import { TooltipProvider } from '@/components/ui/tooltip';
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
  costMarkupPct: null,
  promotionDisplays: null,
  fastDelivery: false,
  micro: false,
  itemCount: 2,
  profitExcludedAt: null,
  profitExclusionReason: null,
};

function renderTable(
  costStatus: 'calculated' | 'excluded',
  rows: OrderListItem[] = [baseRow],
): void {
  render(
    <NextIntlClientProvider
      locale="tr"
      messages={messages}
      formats={FORMATS}
      timeZone="Europe/Istanbul"
    >
      {/* InfoHint (kâr-dışı sebep tooltip'i) Radix Tooltip kullanır → uygulamada
          kökte mount'lu TooltipProvider'ı testte de sağla. */}
      <TooltipProvider>
        <OrdersTable
          rows={rows}
          pagination={{ page: 1, perPage: 25, total: 1, totalPages: 1 }}
          filters={{
            q: '',
            status: null,
            reconciliationStatus: null,
            lossOnly: false,
            from: '',
            to: '',
          }}
          costStatus={costStatus}
          sort="-orderDate"
          counts={{ calculated: 1, excluded: 1 }}
          onCostStatusChange={vi.fn()}
          onFiltersChange={vi.fn()}
          onPaginationChange={vi.fn()}
          onSortChange={vi.fn()}
        />
      </TooltipProvider>
    </NextIntlClientProvider>,
  );
}

describe('OrdersTable segments', () => {
  it('excluded segment shows the per-row reason badge + tab intro (no CTA, no profit column)', () => {
    renderTable('excluded', [
      {
        ...baseRow,
        profitExcludedAt: '2026-04-16T00:00:00.000Z',
        profitExclusionReason: 'COST_DEADLINE_MISSED',
      },
    ]);
    // Her satır KENDİ sebebini gösterir (rozet) + sekme-başı açıklama satırı.
    expect(
      screen.getByText(messages.exclusionReasons.COST_DEADLINE_MISSED.label),
    ).toBeInTheDocument();
    expect(screen.getByText(messages.ordersPage.excludedList.intro)).toBeInTheDocument();
    // Bilgilendirme segmenti — eski iş-listesi CTA'sı yok (spec 2026-06-12 K2) + kâr sütunu yok.
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
