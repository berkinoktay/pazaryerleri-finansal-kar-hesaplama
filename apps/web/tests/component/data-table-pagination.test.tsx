import {
  type ColumnDef,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { NextIntlClientProvider } from 'next-intl';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { DataTablePagination } from '@/components/patterns/data-table-pagination';

import trMessages from '../../messages/tr.json';
import { FORMATS } from '../../src/i18n/formats';
import { render, screen } from '../helpers/render';

interface Row {
  id: string;
  name: string;
}

const COLUMNS: ColumnDef<Row>[] = [
  { accessorKey: 'id', header: 'ID' },
  { accessorKey: 'name', header: 'Name' },
];

function makeRows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({ id: String(i + 1), name: `Row ${i + 1}` }));
}

interface HarnessProps {
  rows: Row[];
  initialPageSize?: number;
  manualPagination?: boolean;
  pageCount?: number;
  rowCount?: number;
}

/**
 * Test harness — mounts a real TanStack table instance and feeds it to
 * DataTablePagination so we can verify behavior at the component boundary
 * (rather than mocking the table interface, which would silently mask any
 * API-shape change in TanStack itself).
 */
function Harness({
  rows,
  initialPageSize = 10,
  manualPagination,
  pageCount,
  rowCount,
}: HarnessProps): React.ReactElement {
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize: initialPageSize });
  const table = useReactTable({
    data: rows,
    columns: COLUMNS,
    state: { pagination },
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: manualPagination ? undefined : getPaginationRowModel(),
    manualPagination,
    pageCount,
    rowCount,
  });
  return <DataTablePagination table={table} />;
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

describe('<DataTablePagination>', () => {
  describe('client-side rendering (50 rows, pageSize 10)', () => {
    it('shows "1–10 / 50 satır" on the first page', () => {
      renderWithIntl(<Harness rows={makeRows(50)} />);
      // Trim to be tolerant of whitespace; en/em dash representation can
      // vary slightly between formatters.
      const text = screen.getByText(/1.+10.+\/.+50.+satır/);
      expect(text).toBeInTheDocument();
    });

    it('shows "Sayfa 1 / 5"', () => {
      renderWithIntl(<Harness rows={makeRows(50)} />);
      expect(screen.getByText(/Sayfa.+1.+\/.+5/)).toBeInTheDocument();
    });

    it('disables first / previous on page 1', () => {
      renderWithIntl(<Harness rows={makeRows(50)} />);
      expect(screen.getByRole('button', { name: 'İlk sayfa' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Önceki sayfa' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Sonraki sayfa' })).not.toBeDisabled();
      expect(screen.getByRole('button', { name: 'Son sayfa' })).not.toBeDisabled();
    });

    it('advances to page 2 when "Sonraki" is clicked', async () => {
      const { user } = renderWithIntl(<Harness rows={makeRows(50)} />);
      await user.click(screen.getByRole('button', { name: 'Sonraki sayfa' }));
      expect(screen.getByText(/Sayfa.+2.+\/.+5/)).toBeInTheDocument();
      expect(screen.getByText(/11.+20.+\/.+50/)).toBeInTheDocument();
    });

    it('jumps to the last page when "Son sayfa" is clicked', async () => {
      const { user } = renderWithIntl(<Harness rows={makeRows(50)} />);
      await user.click(screen.getByRole('button', { name: 'Son sayfa' }));
      expect(screen.getByText(/Sayfa.+5.+\/.+5/)).toBeInTheDocument();
      expect(screen.getByText(/41.+50.+\/.+50/)).toBeInTheDocument();
      // Both forward controls disable at the boundary.
      expect(screen.getByRole('button', { name: 'Sonraki sayfa' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Son sayfa' })).toBeDisabled();
    });

    it('returns to page 1 when "İlk sayfa" is clicked from the last page', async () => {
      const { user } = renderWithIntl(<Harness rows={makeRows(50)} />);
      await user.click(screen.getByRole('button', { name: 'Son sayfa' }));
      await user.click(screen.getByRole('button', { name: 'İlk sayfa' }));
      expect(screen.getByText(/Sayfa.+1.+\/.+5/)).toBeInTheDocument();
    });
  });

  describe('per-page selector', () => {
    it('renders the default page size in the trigger', () => {
      renderWithIntl(<Harness rows={makeRows(50)} initialPageSize={25} />);
      // Radix Select's trigger renders the value as text content.
      expect(screen.getByRole('combobox')).toHaveTextContent('25');
    });

    it('uses tr-TR locale grouping for thousands (1.472 not 1,472)', () => {
      renderWithIntl(<Harness rows={makeRows(1472)} />);
      // The total is rendered as "1.472" in tr-TR. Match permissively in
      // case rendered character is U+002E ("."), U+00A0 (NBSP), or similar.
      expect(screen.getByText(/1[.\s ]?472/)).toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('renders "0 / 0 satır" gracefully when there are no rows', () => {
      renderWithIntl(<Harness rows={[]} />);
      expect(screen.getByText(/0.+\/.+0.+satır/)).toBeInTheDocument();
      // Pagination still renders; "Sayfa 1 / 1" graceful fallback (we clamp
      // pageCount to 1 so the caption never reads "Sayfa 1 / 0").
      expect(screen.getByText(/Sayfa.+1.+\/.+1/)).toBeInTheDocument();
    });

    it('disables every nav button when there is nothing to paginate', () => {
      renderWithIntl(<Harness rows={[]} />);
      expect(screen.getByRole('button', { name: 'İlk sayfa' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Önceki sayfa' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Sonraki sayfa' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Son sayfa' })).toBeDisabled();
    });
  });

  describe('manualPagination (server-side mode)', () => {
    it('reads pageCount from the TanStack config rather than computing it from data', () => {
      // Caller supplies 5 rows on this page but a server-side total of 8 pages.
      renderWithIntl(
        <Harness
          rows={makeRows(5)}
          manualPagination
          pageCount={8}
          rowCount={80}
          initialPageSize={10}
        />,
      );
      expect(screen.getByText(/Sayfa.+1.+\/.+8/)).toBeInTheDocument();
      // 1–5 visible (only 5 rows on this page), 80 total per the controlled rowCount.
      expect(screen.getByText(/1.+5.+\/.+80/)).toBeInTheDocument();
    });

    it('reflects table.getCanNextPage() correctly under manualPagination', () => {
      renderWithIntl(<Harness rows={makeRows(5)} manualPagination pageCount={1} rowCount={5} />);
      // Only one server-side page → forward controls disabled.
      expect(screen.getByRole('button', { name: 'Sonraki sayfa' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Son sayfa' })).toBeDisabled();
    });
  });
});
