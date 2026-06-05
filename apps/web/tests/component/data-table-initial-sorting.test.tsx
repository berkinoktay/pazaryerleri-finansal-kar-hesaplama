import { type ColumnDef } from '@tanstack/react-table';
import { describe, expect, it } from 'vitest';

import { DataTable } from '@/components/patterns/data-table';

import { render, screen, within } from '../helpers/render';

interface Row {
  name: string;
  units: number;
}

const columns: ColumnDef<Row>[] = [
  { accessorKey: 'name', header: () => 'Ürün' },
  { accessorKey: 'units', header: () => 'Adet', meta: { numeric: true } },
];

const data: Row[] = [
  { name: 'A', units: 5 },
  { name: 'B', units: 30 },
  { name: 'C', units: 12 },
];

describe('DataTable initialSorting', () => {
  it('renders rows in the seeded sort order with the column marked sorted', () => {
    render(
      <DataTable columns={columns} data={data} initialSorting={[{ id: 'units', desc: true }]} />,
    );

    const rows = screen.getAllByRole('row');
    // row[0] is the header; data rows follow in sorted (units desc) order.
    expect(within(rows[1]!).getByText('B')).toBeInTheDocument(); // 30
    expect(within(rows[2]!).getByText('C')).toBeInTheDocument(); // 12
    expect(within(rows[3]!).getByText('A')).toBeInTheDocument(); // 5

    expect(screen.getByRole('columnheader', { name: /Adet/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });
});
