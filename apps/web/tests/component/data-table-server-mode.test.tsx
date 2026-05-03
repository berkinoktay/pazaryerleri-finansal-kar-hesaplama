import {
  type ColumnDef,
  type ColumnFiltersState,
  type PaginationState,
  type SortingState,
} from '@tanstack/react-table';
import { NextIntlClientProvider } from 'next-intl';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DataTable } from '@/components/patterns/data-table';
import { DataTablePagination } from '@/components/patterns/data-table-pagination';
import { DataTableToolbar } from '@/components/patterns/data-table-toolbar';

import trMessages from '../../messages/tr.json';
import { FORMATS } from '../../src/i18n/formats';
import { render, screen } from '../helpers/render';

interface Row {
  id: string;
  customer: string;
}

const COLUMNS: ColumnDef<Row>[] = [{ accessorKey: 'customer', header: 'Müşteri' }];

function makeRows(n: number, offset = 0): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: String(offset + i + 1),
    customer: `Row ${offset + i + 1}`,
  }));
}

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider
      locale="tr"
      messages={trMessages}
      formats={FORMATS}
      timeZone="Europe/Istanbul"
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

describe('DataTable server-side controlled mode', () => {
  describe('controlled sorting', () => {
    it('reflects supplied sorting state on the sorted header', () => {
      const onSortingChange = vi.fn();
      renderWithIntl(
        <DataTable
          columns={COLUMNS}
          data={makeRows(3)}
          getRowId={(r) => r.id}
          sorting={[{ id: 'customer', desc: true }]}
          onSortingChange={onSortingChange}
        />,
      );
      // Header button is rendered; its visible content is "Müşteri".
      // We don't assert the icon directly — just that the table mounts
      // with the controlled state without throwing.
      expect(screen.getByRole('button', { name: /Müşteri/ })).toBeInTheDocument();
    });

    it('fires onSortingChange when the user clicks a sortable header', async () => {
      const onSortingChange = vi.fn();
      const { user } = renderWithIntl(
        <DataTable
          columns={COLUMNS}
          data={makeRows(3)}
          getRowId={(r) => r.id}
          sorting={[]}
          onSortingChange={onSortingChange}
        />,
      );
      await user.click(screen.getByRole('button', { name: /Müşteri/ }));
      expect(onSortingChange).toHaveBeenCalledTimes(1);
    });
  });

  describe('controlled pagination (manualPagination)', () => {
    it('uses caller-supplied pageCount + rowCount in the footer caption', () => {
      function Harness() {
        const [paginationState, setPaginationState] = React.useState<PaginationState>({
          pageIndex: 0,
          pageSize: 50,
        });
        return (
          <DataTable
            columns={COLUMNS}
            data={makeRows(50)} // single page slice from a "server"
            getRowId={(r) => r.id}
            paginationState={paginationState}
            onPaginationChange={setPaginationState}
            pageCount={30}
            rowCount={1472}
            pagination={(table) => <DataTablePagination table={table} />}
          />
        );
      }
      renderWithIntl(<Harness />);
      // pageCount=30 → "Sayfa 1 / 30"; rowCount=1472 → "1–50 / 1.472 satır"
      expect(screen.getByText(/Sayfa.+1.+\/.+30/)).toBeInTheDocument();
      expect(screen.getByText(/1.+50.+\/.+1[.\s ]?472/)).toBeInTheDocument();
    });

    it('forwards page changes to onPaginationChange and reflects the new state', async () => {
      const onPaginationChange = vi.fn();
      function Harness() {
        const [pageState, setPageState] = React.useState<PaginationState>({
          pageIndex: 0,
          pageSize: 50,
        });
        return (
          <DataTable
            columns={COLUMNS}
            data={makeRows(50)}
            getRowId={(r) => r.id}
            paginationState={pageState}
            onPaginationChange={(updater) => {
              const next = typeof updater === 'function' ? updater(pageState) : updater;
              onPaginationChange(next);
              setPageState(next);
            }}
            pageCount={30}
            rowCount={1472}
            pagination={(table) => <DataTablePagination table={table} />}
          />
        );
      }
      const { user } = renderWithIntl(<Harness />);
      await user.click(screen.getByRole('button', { name: 'Sonraki sayfa' }));
      expect(onPaginationChange).toHaveBeenCalledWith(expect.objectContaining({ pageIndex: 1 }));
      expect(screen.getByText(/Sayfa.+2.+\/.+30/)).toBeInTheDocument();
    });
  });

  describe('controlled filters', () => {
    it('forwards search-input changes to onColumnFiltersChange', async () => {
      const onColumnFiltersChange = vi.fn();
      function Harness() {
        const [filters, setFilters] = React.useState<ColumnFiltersState>([]);
        return (
          <DataTable
            columns={COLUMNS}
            data={makeRows(3)}
            getRowId={(r) => r.id}
            columnFilters={filters}
            onColumnFiltersChange={(updater) => {
              const next = typeof updater === 'function' ? updater(filters) : updater;
              onColumnFiltersChange(next);
              setFilters(next);
            }}
            toolbar={(table) => <DataTableToolbar table={table} searchColumn="customer" />}
          />
        );
      }
      const { user } = renderWithIntl(<Harness />);
      const searchInput = screen.getByPlaceholderText('Ara…');
      await user.type(searchInput, 'foo');
      expect(onColumnFiltersChange).toHaveBeenCalled();
      // Last call should carry the cumulative filter value.
      const lastCallArgs = onColumnFiltersChange.mock.calls[
        onColumnFiltersChange.mock.calls.length - 1
      ]?.[0] as ColumnFiltersState;
      expect(lastCallArgs).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 'customer', value: 'foo' })]),
      );
    });
  });

  describe('uncontrolled (default) mode', () => {
    it('continues to compute pagination client-side when no paginationState is supplied', () => {
      // 50 rows, default internal pageSize 10 → 5 pages.
      function Harness() {
        return (
          <DataTable
            columns={COLUMNS}
            data={makeRows(50)}
            getRowId={(r) => r.id}
            pagination={(table) => <DataTablePagination table={table} />}
          />
        );
      }
      renderWithIntl(<Harness />);
      expect(screen.getByText(/Sayfa.+1.+\/.+5/)).toBeInTheDocument();
      // Default summary: "1–10 / 50 satır"
      expect(screen.getByText(/1.+10.+\/.+50.+satır/)).toBeInTheDocument();
    });

    it('continues to handle sort + filter client-side when no controlled props are supplied', async () => {
      const data: Row[] = [
        { id: '1', customer: 'Charlie' },
        { id: '2', customer: 'Alice' },
        { id: '3', customer: 'Bob' },
      ];
      const { user } = renderWithIntl(
        <DataTable columns={COLUMNS} data={data} getRowId={(r) => r.id} />,
      );
      // Click header twice → asc then desc; smoke-check the table doesn't
      // throw and the rows still render. (Strict ordering assertions
      // belong in the existing data-table sort tests.)
      const header = screen.getByRole('button', { name: /Müşteri/ });
      await user.click(header);
      await user.click(header);
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Bob')).toBeInTheDocument();
      expect(screen.getByText('Charlie')).toBeInTheDocument();
    });
  });
});
