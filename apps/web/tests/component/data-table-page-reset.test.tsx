import { type ColumnDef } from '@tanstack/react-table';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { DataTable } from '@/components/patterns/data-table';
import { DataTablePagination } from '@/components/patterns/data-table-pagination';

import { render, screen } from '../helpers/render';

interface Row {
  id: string;
  name: string;
}

const COLUMNS: ColumnDef<Row>[] = [{ accessorKey: 'name', header: 'Ürün' }];

function makeRows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({ id: `r${i + 1}`, name: `Ürün ${i + 1}` }));
}

/**
 * Mirrors a feature detail-client: rows live in state and a button forces a re-render that
 * hands the table a BRAND-NEW array with identical content — exactly what
 * `data={[...rows]}` produces every time an unrelated piece of parent state (e.g. a live
 * what-if estimate) changes. The regression: that reference churn must NOT bounce the
 * seller off their current page.
 */
function Harness(): React.ReactElement {
  const base = React.useMemo(() => makeRows(25), []); // 3 pages at pageSize 10
  const [, force] = React.useState(0);
  return (
    <div>
      <button type="button" onClick={() => force((n) => n + 1)}>
        churn
      </button>
      <DataTable<Row, unknown>
        columns={COLUMNS}
        // New array identity on every render — same content, fresh reference.
        data={[...base]}
        getRowId={(row) => row.id}
        pagination={(table) => <DataTablePagination table={table} />}
      />
    </div>
  );
}

describe('DataTable — client pagination survives a data-reference churn (Bug A regression)', () => {
  it('stays on page 2 when an unrelated re-render hands it a new-reference data array', async () => {
    const { user } = render(<Harness />);

    // Go to page 2 (rows 11–20).
    await user.click(screen.getByRole('button', { name: 'Sayfa 2' }));
    expect(screen.getByText('Ürün 11')).toBeInTheDocument();
    expect(screen.queryByText('Ürün 1')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sayfa 2' })).toHaveAttribute('aria-current', 'page');

    // Force a re-render → DataTable receives a fresh `[...base]` array (new identity, same
    // content). With autoResetPageIndex left at TanStack's default this snapped back to
    // page 1; the fix keeps the seller on page 2.
    await user.click(screen.getByRole('button', { name: 'churn' }));

    expect(screen.getByText('Ürün 11')).toBeInTheDocument();
    expect(screen.queryByText('Ürün 1')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sayfa 2' })).toHaveAttribute('aria-current', 'page');
  });
});
