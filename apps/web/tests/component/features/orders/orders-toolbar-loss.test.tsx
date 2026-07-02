import { type ColumnDef, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  OrdersToolbar,
  type OrdersToolbarChange,
} from '@/features/orders/components/orders-toolbar';

import { render, screen } from '../../../helpers/render';

interface Row {
  id: string;
}
const COLUMNS: ColumnDef<Row>[] = [{ id: 'id', header: 'Id', cell: ({ row }) => row.original.id }];
const DATA: Row[] = [{ id: '1' }];

function Harness({
  onChange,
  lossOnly = false,
}: {
  onChange: (next: OrdersToolbarChange) => void;
  lossOnly?: boolean;
}): React.ReactElement {
  const table = useReactTable({ data: DATA, columns: COLUMNS, getCoreRowModel: getCoreRowModel() });
  return (
    <OrdersToolbar
      table={table}
      q=""
      status={null}
      reconciliationStatus={null}
      lossOnly={lossOnly}
      from=""
      to=""
      onChange={onChange}
    />
  );
}

function renderToolbar(props: {
  onChange: (next: OrdersToolbarChange) => void;
  lossOnly?: boolean;
}) {
  return render(<Harness {...props} />);
}

describe('OrdersToolbar — advancedFilter config + export placeholder', () => {
  it('commits { lossOnly: true } when the flag is picked from the add menu (one tap)', async () => {
    const onChange = vi.fn();
    const { user } = renderToolbar({ onChange });

    await user.click(screen.getByRole('button', { name: /Filtre ekle/ }));
    await user.click(await screen.findByText('Sadece zararlı'));

    expect(onChange).toHaveBeenCalledWith({
      status: null,
      reconciliationStatus: null,
      lossOnly: true,
    });
  });

  it('renders the active flag as a chip and removing it clears lossOnly', async () => {
    const onChange = vi.fn();
    const { user } = renderToolbar({ onChange, lossOnly: true });

    const group = screen.getByRole('group', { name: 'Uygulanan filtreler' });
    expect(group).toHaveTextContent('Sadece zararlı');

    await user.click(screen.getByRole('button', { name: 'Filtreyi kaldır' }));
    expect(onChange).toHaveBeenCalledWith({
      status: null,
      reconciliationStatus: null,
      lossOnly: false,
    });
  });

  it('commits an order-status chip through the single-select editor', async () => {
    const onChange = vi.fn();
    const { user } = renderToolbar({ onChange });

    await user.click(screen.getByRole('button', { name: /Filtre ekle/ }));
    await user.click(await screen.findByText('Sipariş durumu'));
    await user.click(await screen.findByText('Teslim edildi'));
    await user.click(screen.getByRole('button', { name: 'Uygula' }));

    expect(onChange).toHaveBeenCalledWith({
      status: 'DELIVERED',
      reconciliationStatus: null,
      lossOnly: false,
    });
  });

  it('shows the server-mode clear ghost and resets ALL six dimensions in one click', async () => {
    const onChange = vi.fn();
    const { user } = renderToolbar({ onChange, lossOnly: true });

    await user.click(screen.getByRole('button', { name: /Temizle/ }));

    expect(onChange).toHaveBeenCalledWith({
      q: '',
      status: null,
      reconciliationStatus: null,
      lossOnly: false,
      from: '',
      to: '',
    });
  });

  it('hides the clear ghost when nothing is filtered', () => {
    renderToolbar({ onChange: vi.fn() });
    expect(screen.queryByRole('button', { name: /Temizle/ })).not.toBeInTheDocument();
  });

  it('renders an export button that is a no-op placeholder (no backend yet)', async () => {
    const onChange = vi.fn();
    const { user } = renderToolbar({ onChange });

    await user.click(screen.getByRole('button', { name: 'Dışa aktar' }));

    expect(onChange).not.toHaveBeenCalled();
  });
});
