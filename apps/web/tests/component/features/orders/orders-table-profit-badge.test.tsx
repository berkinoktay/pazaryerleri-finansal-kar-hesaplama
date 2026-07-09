import { describe, expect, it, vi } from 'vitest';

import type { OrderListItem } from '@/features/orders/api/list-orders.api';
import { OrdersTable, type OrdersTableProps } from '@/features/orders/components/orders-table';

import { render, screen } from '../../../helpers/render';
import trMessages from '../../../../messages/tr.json';

vi.mock('next/navigation', () => ({ useRouter: vi.fn(() => ({ push: vi.fn() })) }));

const OPEN_LABEL = trMessages.profitBadge.open;

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
    costMarkupPct: '38.4',
    promotionDisplays: null,
    fastDelivery: false,
    deliveredOnTime: null,
    micro: false,
    itemCount: 2,
    profitExcludedAt: null,
    profitExclusionReason: null,
    ...overrides,
  };
}

function renderTable(props: Partial<OrdersTableProps> = {}) {
  const onRowOpen = vi.fn();
  const result = render(
    <OrdersTable
      rows={[makeRow()]}
      pagination={{ page: 1, perPage: 25, total: 1, totalPages: 1 }}
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
      counts={{ calculated: 1, excluded: 0 }}
      onCostStatusChange={vi.fn()}
      onFiltersChange={vi.fn()}
      onPaginationChange={vi.fn()}
      onSortChange={vi.fn()}
      onRowOpen={onRowOpen}
      {...props}
    />,
  );
  return { onRowOpen, ...result };
}

describe('OrdersTable — Tahmini kâr profit badge', () => {
  it('renders the estimated profit as a clickable badge that opens the detail modal', async () => {
    const { onRowOpen, user } = renderTable();
    const badge = screen.getByRole('button', { name: OPEN_LABEL });
    // tr-TR: '60.00' → '60,00 ₺' (comma decimal); the badge carries the amount.
    expect(badge).toHaveTextContent(/60,00/);
    await user.click(badge);
    expect(onRowOpen).toHaveBeenCalledWith('o1');
  });

  it('does NOT open the modal when the row body (not the badge) is clicked in the calculated tab', async () => {
    const { onRowOpen, user } = renderTable();
    // Click a plain, non-interactive cell — the order number text.
    await user.click(screen.getByText('ON-1'));
    expect(onRowOpen).not.toHaveBeenCalled();
  });

  it('opens nothing in the profit-excluded tab — no badge, row not clickable', async () => {
    const { onRowOpen, user } = renderTable({
      costStatus: 'excluded',
      rows: [makeRow({ estimatedNetProfit: null, saleMarginPct: null })],
      counts: { calculated: 0, excluded: 1 },
    });
    // Excluded orders have no profit breakdown → no profit badge. The row is also
    // NOT clickable: opening an empty sheet is pointless (the exclusion reason is
    // shown inline in its own column).
    expect(screen.queryByRole('button', { name: OPEN_LABEL })).toBeNull();
    await user.click(screen.getByText('ON-1'));
    expect(onRowOpen).not.toHaveBeenCalled();
  });
});
