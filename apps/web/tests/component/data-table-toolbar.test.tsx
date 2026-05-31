import { type ColumnDef, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DataTableToolbar } from '@/components/patterns/data-table-toolbar';

import trMessages from '../../messages/tr.json';
import { FORMATS } from '../../src/i18n/formats';
import { render, screen } from '../helpers/render';

interface Row {
  id: string;
  name: string;
}
const COLUMNS: ColumnDef<Row>[] = [
  { id: 'name', header: 'Name', cell: ({ row }) => row.original.name },
];
const DATA: Row[] = [{ id: '1', name: 'Foo' }];

function Harness({
  searchValue,
  onSearchChange,
}: {
  searchValue: string;
  onSearchChange: (s: string) => void;
}): React.ReactElement {
  const table = useReactTable({
    data: DATA,
    columns: COLUMNS,
    getCoreRowModel: getCoreRowModel(),
  });
  return (
    <DataTableToolbar
      table={table}
      searchValue={searchValue}
      onSearchChange={onSearchChange}
      searchPlaceholder="Ara…"
    />
  );
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

describe('DataTableToolbar controlled-search mode', () => {
  it('renders the search input with the provided value', () => {
    renderWithIntl(<Harness searchValue="hello" onSearchChange={() => {}} />);
    expect(screen.getByPlaceholderText('Ara…')).toHaveValue('hello');
  });

  it('calls onSearchChange on input', async () => {
    const onSearchChange = vi.fn();
    const { user } = renderWithIntl(<Harness searchValue="" onSearchChange={onSearchChange} />);
    await user.type(screen.getByPlaceholderText('Ara…'), 'a');
    expect(onSearchChange).toHaveBeenCalledWith('a');
  });
});

describe('DataTableToolbar column-visibility menu', () => {
  interface MenuRow {
    id: string;
    customer: string;
    grossAmount: number;
  }
  const MENU_COLUMNS: ColumnDef<MenuRow>[] = [
    // Utility column: function header + not hideable → excluded from the menu
    // (its machine id must never surface to the user).
    {
      id: 'select',
      header: () => <input type="checkbox" aria-label="all" />,
      enableHiding: false,
    },
    // Plain-string header → label resolves to the header text.
    { accessorKey: 'customer', header: 'Müşteri' },
    // Function header → must fall back to meta.label, never the machine id.
    { accessorKey: 'grossAmount', header: () => <span>↕</span>, meta: { label: 'Ciro' } },
  ];
  const MENU_DATA: MenuRow[] = [{ id: '1', customer: 'Foo', grossAmount: 100 }];

  function MenuHarness(): React.ReactElement {
    const table = useReactTable({
      data: MENU_DATA,
      columns: MENU_COLUMNS,
      getCoreRowModel: getCoreRowModel(),
    });
    return <DataTableToolbar table={table} />;
  }

  it('shows human labels (meta.label / header), never raw column ids, and hides utility columns', async () => {
    const { user } = renderWithIntl(<MenuHarness />);
    await user.click(screen.getByRole('button', { name: 'Kolonları düzenle' }));
    const menu = await screen.findByRole('menu');

    expect(within(menu).getByText('Müşteri')).toBeInTheDocument();
    expect(within(menu).getByText('Ciro')).toBeInTheDocument();
    // The machine ids must never appear.
    expect(within(menu).queryByText('grossAmount')).not.toBeInTheDocument();
    expect(within(menu).queryByText('customer')).not.toBeInTheDocument();
    // The non-hideable utility column is excluded entirely.
    expect(within(menu).queryByText('select')).not.toBeInTheDocument();
  });
});
