import {
  type ColumnDef,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { NextIntlClientProvider } from 'next-intl';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { DataTableLoadingContext } from '@/components/patterns/data-table';
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
  describe('loading (via DataTableLoadingContext)', () => {
    // A cold server-paginated load: the table instance reports 0 rows / 1 page
    // as if they were facts. The footer must show placeholders, not assert them.
    it('swaps the count labels for placeholders and holds navigation', () => {
      renderWithIntl(
        <DataTableLoadingContext.Provider value={true}>
          <Harness rows={[]} manualPagination pageCount={1} rowCount={0} />
        </DataTableLoadingContext.Provider>,
      );
      expect(screen.queryByText(/satır/)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Sayfa 1' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Önceki sayfa' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Sonraki sayfa' })).toBeDisabled();
    });

    it('renders real figures again once loading ends (default context)', () => {
      renderWithIntl(<Harness rows={makeRows(50)} />);
      expect(screen.getByText(/1.+10.+\/.+50.+satır/)).toBeInTheDocument();
    });
  });

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

    it('disables previous on page 1 and marks page 1 active', () => {
      renderWithIntl(<Harness rows={makeRows(50)} />);
      expect(screen.getByRole('button', { name: 'Önceki sayfa' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Sonraki sayfa' })).not.toBeDisabled();
      expect(screen.getByRole('button', { name: 'Sayfa 1' })).toHaveAttribute(
        'aria-current',
        'page',
      );
    });

    it('renders a numbered strip (5 pages, all shown) with the active page highlighted', () => {
      renderWithIntl(<Harness rows={makeRows(50)} />);
      expect(screen.getByRole('button', { name: 'Sayfa 3' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Sayfa 5' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Sayfa 1' })).toHaveAttribute(
        'aria-current',
        'page',
      );
    });

    it('collapses a long range with an ellipsis (20 pages, near the start)', () => {
      renderWithIntl(<Harness rows={makeRows(200)} />);
      // 1 2 3 4 5 … 20 — first + last always present, the middle collapsed.
      expect(screen.getByRole('button', { name: 'Sayfa 1' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Sayfa 20' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Sayfa 10' })).not.toBeInTheDocument();
    });

    it('advances to page 2 when "Sonraki" is clicked', async () => {
      const { user } = renderWithIntl(<Harness rows={makeRows(50)} />);
      await user.click(screen.getByRole('button', { name: 'Sonraki sayfa' }));
      expect(screen.getByText(/Sayfa.+2.+\/.+5/)).toBeInTheDocument();
      expect(screen.getByText(/11.+20.+\/.+50/)).toBeInTheDocument();
    });

    it('jumps straight to a page when its number is clicked', async () => {
      const { user } = renderWithIntl(<Harness rows={makeRows(50)} />);
      await user.click(screen.getByRole('button', { name: 'Sayfa 5' }));
      expect(screen.getByText(/Sayfa.+5.+\/.+5/)).toBeInTheDocument();
      expect(screen.getByText(/41.+50.+\/.+50/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Sonraki sayfa' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Sayfa 5' })).toHaveAttribute(
        'aria-current',
        'page',
      );
    });

    it('returns to page 1 when its number is clicked from the last page', async () => {
      const { user } = renderWithIntl(<Harness rows={makeRows(50)} />);
      await user.click(screen.getByRole('button', { name: 'Sayfa 5' }));
      await user.click(screen.getByRole('button', { name: 'Sayfa 1' }));
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

    it('disables prev + next when there is nothing to paginate', () => {
      renderWithIntl(<Harness rows={[]} />);
      expect(screen.getByRole('button', { name: 'Önceki sayfa' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Sonraki sayfa' })).toBeDisabled();
      // The single clamped page still renders as an active "Sayfa 1".
      expect(screen.getByRole('button', { name: 'Sayfa 1' })).toHaveAttribute(
        'aria-current',
        'page',
      );
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
      // Only one server-side page → forward control disabled.
      expect(screen.getByRole('button', { name: 'Sonraki sayfa' })).toBeDisabled();
    });
  });
});
