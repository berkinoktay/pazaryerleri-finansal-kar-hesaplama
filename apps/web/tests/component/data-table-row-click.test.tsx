import { type ColumnDef } from '@tanstack/react-table';
import { NextIntlClientProvider } from 'next-intl';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DataTable } from '@/components/patterns/data-table';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

import trMessages from '../../messages/tr.json';
import { FORMATS } from '../../src/i18n/formats';
import { render, screen, within } from '../helpers/render';

interface Row {
  id: string;
  customer: string;
}

const ROWS: Row[] = [
  { id: '1', customer: 'Ayşe Yılmaz' },
  { id: '2', customer: 'Mehmet Kaya' },
];

const COLUMNS: ColumnDef<Row>[] = [
  {
    id: 'select',
    header: 'Seç',
    enableSorting: false,
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label={`Satır ${row.original.id} seç`}
      />
    ),
  },
  { accessorKey: 'customer', header: 'Müşteri' },
  {
    id: 'actions',
    header: 'Aksiyon',
    enableSorting: false,
    cell: ({ row }) => (
      <Button
        size="sm"
        variant="ghost"
        aria-label={`${row.original.customer} menü`}
        onClick={() => undefined}
      >
        ⋮
      </Button>
    ),
  },
];

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

describe('DataTable onRowClick', () => {
  describe('without onRowClick', () => {
    it('rows stay passive (no role, no tabIndex)', () => {
      const { container } = renderWithIntl(
        <DataTable columns={COLUMNS} data={ROWS} getRowId={(r) => r.id} enableRowSelection />,
      );
      const bodyRows = container.querySelectorAll('tbody tr');
      for (const row of bodyRows) {
        expect(row.getAttribute('role')).toBeNull();
        expect(row.getAttribute('tabindex')).toBeNull();
      }
    });
  });

  describe('with onRowClick', () => {
    it('rows expose role="button" + tabIndex=0', () => {
      const { container } = renderWithIntl(
        <DataTable
          columns={COLUMNS}
          data={ROWS}
          getRowId={(r) => r.id}
          enableRowSelection
          onRowClick={() => undefined}
        />,
      );
      const bodyRows = container.querySelectorAll('tbody tr');
      expect(bodyRows.length).toBe(2);
      for (const row of bodyRows) {
        expect(row.getAttribute('role')).toBe('button');
        expect(row.getAttribute('tabindex')).toBe('0');
      }
    });

    it('fires when the user clicks a non-interactive cell', async () => {
      const onRowClick = vi.fn();
      const { user } = renderWithIntl(
        <DataTable
          columns={COLUMNS}
          data={ROWS}
          getRowId={(r) => r.id}
          enableRowSelection
          onRowClick={onRowClick}
        />,
      );
      // Customer name is plain text inside a TableCell — no interactive
      // ancestor up to the row.
      await user.click(screen.getByText('Ayşe Yılmaz'));
      expect(onRowClick).toHaveBeenCalledTimes(1);
      expect(onRowClick).toHaveBeenCalledWith(
        expect.objectContaining({ id: '1', customer: 'Ayşe Yılmaz' }),
        expect.anything(),
      );
    });

    it('does NOT fire when the user toggles the row checkbox', async () => {
      const onRowClick = vi.fn();
      const { user } = renderWithIntl(
        <DataTable
          columns={COLUMNS}
          data={ROWS}
          getRowId={(r) => r.id}
          enableRowSelection
          onRowClick={onRowClick}
        />,
      );
      const firstRow = screen.getByText('Ayşe Yılmaz').closest('tr') as HTMLElement;
      const checkbox = within(firstRow).getByRole('checkbox', { name: /Satır 1 seç/ });
      await user.click(checkbox);
      expect(onRowClick).not.toHaveBeenCalled();
    });

    it('does NOT fire when the user clicks an inline action button', async () => {
      const onRowClick = vi.fn();
      const { user } = renderWithIntl(
        <DataTable
          columns={COLUMNS}
          data={ROWS}
          getRowId={(r) => r.id}
          enableRowSelection
          onRowClick={onRowClick}
        />,
      );
      await user.click(screen.getByRole('button', { name: 'Ayşe Yılmaz menü' }));
      expect(onRowClick).not.toHaveBeenCalled();
    });

    it('fires on Enter when a row has keyboard focus', async () => {
      const onRowClick = vi.fn();
      const { user } = renderWithIntl(
        <DataTable
          columns={COLUMNS}
          data={ROWS}
          getRowId={(r) => r.id}
          enableRowSelection
          onRowClick={onRowClick}
        />,
      );
      const firstRow = screen.getByText('Ayşe Yılmaz').closest('tr') as HTMLTableRowElement;
      firstRow.focus();
      await user.keyboard('{Enter}');
      expect(onRowClick).toHaveBeenCalledTimes(1);
      expect(onRowClick).toHaveBeenCalledWith(
        expect.objectContaining({ id: '1' }),
        expect.anything(),
      );
    });

    it('fires on Space when a row has keyboard focus', async () => {
      const onRowClick = vi.fn();
      const { user } = renderWithIntl(
        <DataTable
          columns={COLUMNS}
          data={ROWS}
          getRowId={(r) => r.id}
          enableRowSelection
          onRowClick={onRowClick}
        />,
      );
      const firstRow = screen.getByText('Ayşe Yılmaz').closest('tr') as HTMLTableRowElement;
      firstRow.focus();
      // Space in user-event is " " — preventDefault is essential here so
      // the test environment doesn't scroll on space.
      await user.keyboard(' ');
      expect(onRowClick).toHaveBeenCalledTimes(1);
    });

    it('honours the data-row-action opt-out for non-standard interactive children', async () => {
      const onRowClick = vi.fn();
      const customCols: ColumnDef<Row>[] = [
        {
          accessorKey: 'customer',
          header: 'Müşteri',
          cell: ({ row }) => (
            <>
              <span>{row.original.customer}</span>
              {/* Stylized clickable span — no native interactive role,
                  but data-row-action signals the click is its own. */}
              <span data-row-action data-testid={`opt-out-${row.original.id}`}>
                Opt-out child
              </span>
            </>
          ),
        },
      ];
      const { user } = renderWithIntl(
        <DataTable
          columns={customCols}
          data={ROWS}
          getRowId={(r) => r.id}
          onRowClick={onRowClick}
        />,
      );
      await user.click(screen.getByTestId('opt-out-1'));
      expect(onRowClick).not.toHaveBeenCalled();
      // Sanity check: clicking the plain text sibling DOES fire.
      await user.click(screen.getByText('Ayşe Yılmaz'));
      expect(onRowClick).toHaveBeenCalledTimes(1);
    });
  });
});
