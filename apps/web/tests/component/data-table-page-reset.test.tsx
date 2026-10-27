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

/**
 * Mirrors a feature that filters its rows client-side (search / chips) and hands DataTable the
 * narrowed set. The regression: with autoResetPageIndex off, a set that shrinks below the
 * current page left the table PAST its last page — an empty body that read as "no matching
 * rows" while the matches sat on page 1.
 */
function ShrinkHarness(): React.ReactElement {
  const base = React.useMemo(() => makeRows(25), []); // 3 pages at pageSize 10
  const [size, setSize] = React.useState(25);
  return (
    <div>
      <button type="button" onClick={() => setSize(12)}>
        two pages
      </button>
      <button type="button" onClick={() => setSize(3)}>
        one page
      </button>
      <DataTable<Row, unknown>
        columns={COLUMNS}
        data={base.slice(0, size)}
        getRowId={(row) => row.id}
        hasActiveFilters={size < 25}
        pagination={(table) => <DataTablePagination table={table} />}
      />
    </div>
  );
}

describe('DataTable — a shrinking client-side set never strands the table past its last page', () => {
  it('steps back to the last page that still exists', async () => {
    const { user } = render(<ShrinkHarness />);

    await user.click(screen.getByRole('button', { name: 'Sayfa 3' }));
    expect(screen.getByText('Ürün 21')).toBeInTheDocument();

    // 12 rows = 2 pages: page 3 no longer exists, so the table lands on page 2.
    await user.click(screen.getByRole('button', { name: 'two pages' }));
    expect(screen.getByText('Ürün 11')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sayfa 2' })).toHaveAttribute('aria-current', 'page');

    // 3 rows = 1 page: the matches show instead of a "no matching rows" state.
    await user.click(screen.getByRole('button', { name: 'one page' }));
    expect(screen.getByText('Ürün 1')).toBeInTheDocument();
    expect(screen.getByText('Ürün 3')).toBeInTheDocument();
  });
});
