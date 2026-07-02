import { type ColumnDef, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  ReturnsToolbar,
  type ReturnsToolbarChange,
} from '@/features/returns/components/returns-toolbar';

import { render, screen } from '../../../helpers/render';

interface Row {
  id: string;
}
const COLUMNS: ColumnDef<Row>[] = [{ id: 'id', header: 'Id', cell: ({ row }) => row.original.id }];
const DATA: Row[] = [{ id: '1' }];

function Harness({
  onChange,
  q = '',
  from = '',
  to = '',
}: {
  onChange: (next: ReturnsToolbarChange) => void;
  q?: string;
  from?: string;
  to?: string;
}): React.ReactElement {
  const table = useReactTable({ data: DATA, columns: COLUMNS, getCoreRowModel: getCoreRowModel() });
  return <ReturnsToolbar table={table} q={q} from={from} to={to} onChange={onChange} />;
}

describe('ReturnsToolbar — DataTableToolbar composition', () => {
  it('emits search changes through the controlled toolbar search', async () => {
    const onChange = vi.fn();
    const { user } = render(<Harness onChange={onChange} />);
    await user.type(screen.getByRole('textbox'), 'a');
    expect(onChange).toHaveBeenCalledWith({ q: 'a' });
  });

  it('shows the server-mode clear ghost and resets q + date range in one click', async () => {
    const onChange = vi.fn();
    const { user } = render(<Harness onChange={onChange} q="kalem" from="2026-06-01" to="" />);
    await user.click(screen.getByRole('button', { name: /Temizle/ }));
    expect(onChange).toHaveBeenCalledWith({ q: '', from: '', to: '' });
  });

  it('hides the clear ghost when nothing is filtered', () => {
    render(<Harness onChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Temizle/ })).not.toBeInTheDocument();
  });
});
