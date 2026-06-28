import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { OrderListItem } from '@/features/orders/api/list-orders.api';
import { OrdersTable } from '@/features/orders/components/orders-table';

import { render, screen } from '../../../helpers/render';
import trMessages from '../../../../messages/tr.json';

vi.mock('next/navigation', () => ({ useRouter: vi.fn(() => ({ push: vi.fn() })) }));

const RETURN_SCENARIO_HEADER = trMessages.ordersPage.table.columns.returnScenarioProfit;

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

function renderTable(rows: OrderListItem[]): void {
  render(
    <OrdersTable
      rows={rows}
      pagination={{ page: 1, perPage: 25, total: rows.length, totalPages: 1 }}
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
      counts={{ calculated: rows.length, excluded: 0 }}
      onCostStatusChange={vi.fn()}
      onFiltersChange={vi.fn()}
      onPaginationChange={vi.fn()}
      onSortChange={vi.fn()}
    />,
  );
}

describe('OrdersTable — iade senaryosu kari kolonu', () => {
  it('renders the column header', () => {
    renderTable([makeRow()]);
    expect(screen.getByText(RETURN_SCENARIO_HEADER)).toBeInTheDocument();
  });

  it('shows the formatted value when returnScenarioNetProfit is a string', () => {
    // Fill all nullable currency/margin cells so zero em-dashes appear on the row.
    // The only nullable columns in the calculated segment are estimatedNetProfit,
    // settledNetProfit, returnScenarioNetProfit, saleMarginPct, and costMarkupPct —
    // makeRow already fills estimatedNetProfit/saleMarginPct/costMarkupPct; we
    // add settledNetProfit here so the row has no dash at all when
    // returnScenarioNetProfit is set to a real value.
    renderTable([
      makeRow({
        returnScenarioNetProfit: '-160.19',
        settledNetProfit: '58.00',
      }),
    ]);
    expect(screen.getByText(RETURN_SCENARIO_HEADER)).toBeInTheDocument();
    // tr-TR locale: '-160.19' → '−160,19 ₺' (comma decimal separator).
    // Match the digit fragment — robust against exact symbol/sign encoding.
    expect(screen.getByText(/160,19/)).toBeInTheDocument();
    // No em-dashes anywhere on the row — proves the return-scenario cell rendered
    // a real value and not a dash.
    expect(screen.queryAllByText('—')).toHaveLength(0);
  });

  it('shows an em-dash when returnScenarioNetProfit is null', () => {
    // Make all non-nullable cells filled so we can count em-dashes more precisely.
    renderTable([
      makeRow({
        returnScenarioNetProfit: null,
        settledNetProfit: '58.00',
      }),
    ]);
    expect(screen.getByText(RETURN_SCENARIO_HEADER)).toBeInTheDocument();
    // With settledNetProfit filled and returnScenarioNetProfit null,
    // the return-scenario cell shows the em-dash.
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
