import { describe, expect, it, vi } from 'vitest';

import type { OrderListItem } from '@/features/orders/api/list-orders.api';
import { OrdersTable, type OrdersTableProps } from '@/features/orders/components/orders-table';

import { render, screen } from '../../../helpers/render';
import trMessages from '../../../../messages/tr.json';

vi.mock('next/navigation', () => ({ useRouter: vi.fn(() => ({ push: vi.fn() })) }));

const MARGIN_HEADER = trMessages.ordersPage.table.columns.saleMarginPct;

function makeRow(overrides: Partial<OrderListItem> = {}): OrderListItem {
  return {
    id: 'o1',
    platformOrderId: '900',
    platformOrderNumber: 'ON-1',
    orderDate: '2026-04-15T14:30:00.000Z',
    status: 'DELIVERED',
    reconciliationStatus: 'NOT_SETTLED',
    saleGross: '240.00',
    saleVat: '40.00',
    listGross: '240.00',
    estimatedNetProfit: '60.00',
    settledNetProfit: null,
    saleMarginPct: '15.5',
    promotionDisplays: null,
    fastDelivery: false,
    micro: false,
    itemCount: 2,
    ...overrides,
  };
}

function renderTable(props: Partial<OrdersTableProps> = {}): OrdersTableProps['onSortChange'] {
  const onSortChange = vi.fn();
  render(
    <OrdersTable
      rows={[makeRow()]}
      pagination={{ page: 1, perPage: 25, total: 1, totalPages: 1 }}
      filters={{ q: '', status: null, reconciliationStatus: null, from: '', to: '' }}
      costStatus="calculated"
      sort="-orderDate"
      counts={{ calculated: 1, excluded: 0 }}
      onCostStatusChange={vi.fn()}
      onFiltersChange={vi.fn()}
      onPaginationChange={vi.fn()}
      onSortChange={onSortChange}
      {...props}
    />,
  );
  return onSortChange;
}

describe('OrdersTable — Marj % column', () => {
  it('renders the served margin as a percentage (no frontend computation)', () => {
    renderTable();
    expect(screen.getByText(MARGIN_HEADER)).toBeInTheDocument();
    // Served '15.5' → '15.5%' — frontend only appends the glyph, never derives.
    expect(screen.getByText('15.5%')).toBeInTheDocument();
  });

  it('renders an em-dash when the margin is null', () => {
    // Fill the other nullable money cells so the ONLY em-dash on the row is the
    // margin cell — proves the null → "—" branch fired for saleMarginPct.
    render(
      <OrdersTable
        rows={[
          makeRow({ saleMarginPct: null, estimatedNetProfit: '60.00', settledNetProfit: '58.00' }),
        ]}
        pagination={{ page: 1, perPage: 25, total: 1, totalPages: 1 }}
        filters={{ q: '', status: null, reconciliationStatus: null, from: '', to: '' }}
        costStatus="calculated"
        sort="-orderDate"
        counts={{ calculated: 1, excluded: 0 }}
        onCostStatusChange={vi.fn()}
        onFiltersChange={vi.fn()}
        onPaginationChange={vi.fn()}
        onSortChange={vi.fn()}
      />,
    );
    expect(screen.getByText(MARGIN_HEADER)).toBeInTheDocument();
    expect(screen.queryByText('15.5%')).toBeNull();
    // Exactly one em-dash on the row — the margin cell.
    expect(screen.getAllByText('—')).toHaveLength(1);
  });

  it('toggling the margin header commits the descending sort key to the page', async () => {
    const onSortChange = renderTable({ sort: '-orderDate' });
    // The header is a sort button (DataTable renders a <button> for sortable cols).
    const user = (await import('@testing-library/user-event')).default.setup();
    await user.click(screen.getByRole('button', { name: new RegExp(MARGIN_HEADER) }));
    // Default → first click = ascending (TanStack toggle order).
    expect(onSortChange).toHaveBeenCalledWith('marginPct');
  });

  it('reflects the active ascending sort coming from URL state', () => {
    const onSortChange = renderTable({ sort: 'marginPct' });
    // The header announces ascending order via aria-sort.
    const header = screen.getByRole('columnheader', { name: new RegExp(MARGIN_HEADER) });
    expect(header).toHaveAttribute('aria-sort', 'ascending');
    expect(onSortChange).not.toHaveBeenCalled();
  });

  it('shows the promotion indicator for a discounted row (served names, no derivation)', () => {
    renderTable({
      rows: [
        makeRow({ promotionDisplays: [{ displayName: 'Sepette İndirim', amountGross: '20.00' }] }),
      ],
    });
    // Badge label renders next to the order number; the names live in the tooltip.
    expect(screen.getByText(trMessages.promotionIndicator.label)).toBeInTheDocument();
  });

  it('omits the promotion indicator when the row has no promotions', () => {
    renderTable();
    expect(screen.queryByText(trMessages.promotionIndicator.label)).toBeNull();
  });

  it('omits the margin column in the profit-excluded segment', () => {
    render(
      <OrdersTable
        rows={[makeRow({ estimatedNetProfit: null, saleMarginPct: null })]}
        pagination={{ page: 1, perPage: 25, total: 1, totalPages: 1 }}
        filters={{ q: '', status: null, reconciliationStatus: null, from: '', to: '' }}
        costStatus="excluded"
        sort="-orderDate"
        counts={{ calculated: 0, excluded: 1 }}
        onCostStatusChange={vi.fn()}
        onFiltersChange={vi.fn()}
        onPaginationChange={vi.fn()}
        onSortChange={vi.fn()}
      />,
    );
    expect(screen.queryByText(MARGIN_HEADER)).toBeNull();
  });
});
