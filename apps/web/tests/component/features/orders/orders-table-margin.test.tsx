import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { OrderListItem } from '@/features/orders/api/list-orders.api';
import { MarginColoringContext } from '@/lib/margin-coloring-context';
import { OrdersTable, type OrdersTableProps } from '@/features/orders/components/orders-table';
import type { MarginScale } from '@/lib/margin-coloring';

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
    costMarkupPct: '38.4',
    promotionDisplays: null,
    fastDelivery: false,
    micro: false,
    itemCount: 2,
    profitExcludedAt: null,
    profitExclusionReason: null,
    returnScenarioNetProfit: null,
    ...overrides,
  };
}

function renderTable(
  props: Partial<OrdersTableProps> = {},
  scale: MarginScale | null = null,
): OrdersTableProps['onSortChange'] {
  const onSortChange = vi.fn();
  const table = (
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
      onSortChange={onSortChange}
      {...props}
    />
  );
  // Wrap in MarginColoringContext to inject the scale without needing the full provider.
  render(<MarginColoringContext.Provider value={scale}>{table}</MarginColoringContext.Provider>);
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
          makeRow({
            saleMarginPct: null,
            estimatedNetProfit: '60.00',
            settledNetProfit: '58.00',
            returnScenarioNetProfit: '-160.19',
          }),
        ]}
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
        filters={{
          q: '',
          status: null,
          reconciliationStatus: null,
          lossOnly: false,
          from: '',
          to: '',
        }}
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

describe('OrdersTable — marj renklendirme (binary vs scale)', () => {
  it('binary mode (scale null): positive margin cell carries text-success class', () => {
    // Pass null scale -> binary fallback via profitToneClass.
    renderTable({ rows: [makeRow({ saleMarginPct: '15.5' })] }, null);
    const cell = screen.getByText('15.5%');
    expect(cell.className).toContain('text-success');
    expect(cell).not.toHaveAttribute('style');
  });

  it('binary mode (scale null): negative margin cell carries text-destructive class', () => {
    renderTable({ rows: [makeRow({ saleMarginPct: '-5.0' })] }, null);
    const cell = screen.getByText('-5.0%');
    expect(cell.className).toContain('text-destructive');
    expect(cell).not.toHaveAttribute('style');
  });

  it('scale-enabled mode: margin cell carries inline style color from the bucket', () => {
    // Use rgb() instead of oklch() — happy-dom's CSS parser does not support oklch,
    // which causes style.color assignment to be silently discarded.
    const scale: MarginScale = {
      enabled: true,
      buckets: [
        { threshold: 0, color: 'rgb(200, 50, 50)' }, // "loss red" (readable by happy-dom)
        { threshold: 20, color: 'rgb(50, 180, 50)' }, // "profit green"
      ],
    };
    // saleMarginPct '15.5' -> >= 0 but < 20 -> bucket[0] color rgb(200, 50, 50).
    renderTable({ rows: [makeRow({ saleMarginPct: '15.5' })] }, scale);
    const cell = screen.getByText('15.5%');
    // The inline style.color is the bucket color (overrides the class color visually).
    expect(cell.style.color).toBe('rgb(200, 50, 50)');
    // The original binary tone class is kept as the OFF-state baseline; the inline
    // style overrides it when ON. This is the "layered" approach: class = baseline,
    // style = override (OFF-parity invariant: when style is removed, original shows).
    expect(cell.className).toContain('text-success');
  });
});
