import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { OrdersEmptyState } from '@/features/orders/components/orders-empty-state';
import { OrdersTable } from '@/features/orders/components/orders-table';

import messages from '../../../../messages/tr.json';
import { FORMATS } from '../../../../src/i18n/formats';

vi.mock('next/navigation', () => ({ useRouter: vi.fn(() => ({ push: vi.fn() })) }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

function renderTable(empty?: React.ReactNode): void {
  render(
    <NextIntlClientProvider
      locale="tr"
      messages={messages}
      formats={FORMATS}
      timeZone="Europe/Istanbul"
    >
      <OrdersTable
        rows={[]}
        empty={empty}
        pagination={{ page: 1, perPage: 25, total: 0, totalPages: 0 }}
        filters={{
          q: '',
          status: null,
          reconciliationStatus: null,
          lossOnly: false,
          from: '',
          to: '',
        }}
        costStatus="calculated"
        sort="-orderDate"
        counts={{ calculated: 0, excluded: 0 }}
        onCostStatusChange={vi.fn()}
        onFiltersChange={vi.fn()}
        onPaginationChange={vi.fn()}
        onSortChange={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

describe('OrdersTable empty body', () => {
  it('keeps the table chrome and shows the page-supplied empty override when there are zero rows and no filter', () => {
    renderTable(<OrdersEmptyState variant="no-orders" embedded />);

    // The chrome stays mounted — column headers render even with zero rows, so
    // there is no full-page takeover (the regression we fixed).
    expect(screen.getAllByRole('columnheader').length).toBeGreaterThan(0);
    // The richer welcome body the page client passes for a genuinely-empty store
    // renders INSIDE the table.
    expect(screen.getByText(messages.ordersPage.empty.noOrders.title)).toBeInTheDocument();
  });

  it('falls back to the per-tab default empty body when no override is provided', () => {
    renderTable(undefined);

    expect(screen.getByText(messages.ordersPage.tabs.emptyCalculated)).toBeInTheDocument();
  });
});
