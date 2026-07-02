import { type ColumnDef, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  DataTableToolbar,
  type DataTableToolbarAdvancedFilter,
} from '@/components/patterns/data-table-toolbar';
import type { FilterFieldDef, FilterRow } from '@/lib/advanced-filter';

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

describe('DataTableToolbar advancedFilter mode', () => {
  const FIELDS: FilterFieldDef[] = [
    {
      key: 'salePrice',
      label: 'Satış fiyatı',
      groupLabel: 'Aralık',
      dataType: 'money',
      operators: ['between', 'gte', 'lte', 'eq'],
      unit: '₺',
    },
    {
      key: 'missingCost',
      label: 'Maliyeti boş',
      groupLabel: 'Bayrak',
      dataType: 'flag',
      operators: ['isTrue'],
    },
  ];
  const PRICE_ROW: FilterRow = {
    id: 'r-price',
    field: 'salePrice',
    operator: 'between',
    value: ['20', ''],
  };
  const FLAG_ROW: FilterRow = { id: 'r-flag', field: 'missingCost', operator: 'isTrue', value: '' };

  function AdvancedHarness({
    value,
    onApply,
  }: Pick<DataTableToolbarAdvancedFilter, 'value' | 'onApply'>): React.ReactElement {
    const table = useReactTable({
      data: DATA,
      columns: COLUMNS,
      getCoreRowModel: getCoreRowModel(),
    });
    return <DataTableToolbar table={table} advancedFilter={{ fields: FIELDS, value, onApply }} />;
  }

  it('mounts the add-filter button in the control row', () => {
    renderWithIntl(<AdvancedHarness value={[]} onApply={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Filtre ekle/ })).toBeInTheDocument();
  });

  it('renders no chip row while no filter is applied', () => {
    renderWithIntl(<AdvancedHarness value={[]} onApply={vi.fn()} />);
    expect(screen.queryByRole('group', { name: 'Uygulanan filtreler' })).not.toBeInTheDocument();
  });

  it('derives the auto chip row from the applied rows', () => {
    renderWithIntl(<AdvancedHarness value={[PRICE_ROW, FLAG_ROW]} onApply={vi.fn()} />);
    const group = screen.getByRole('group', { name: 'Uygulanan filtreler' });
    expect(within(group).getByText('Satış fiyatı:')).toBeInTheDocument();
    expect(within(group).getByText('Maliyeti boş')).toBeInTheDocument();
  });

  it('removing a chip commits the remaining set', async () => {
    const onApply = vi.fn();
    const { user } = renderWithIntl(
      <AdvancedHarness value={[PRICE_ROW, FLAG_ROW]} onApply={onApply} />,
    );
    const removeButtons = screen.getAllByRole('button', { name: 'Filtreyi kaldır' });
    await user.click(removeButtons[0]!);
    expect(onApply).toHaveBeenCalledWith([FLAG_ROW]);
  });

  it('the clear-all link commits an empty set', async () => {
    const onApply = vi.fn();
    const { user } = renderWithIntl(
      <AdvancedHarness value={[PRICE_ROW, FLAG_ROW]} onApply={onApply} />,
    );
    await user.click(screen.getByRole('button', { name: 'Tümünü temizle' }));
    expect(onApply).toHaveBeenCalledWith([]);
  });

  it('a chip body opens the editor and Uygula commits the edited row', async () => {
    const onApply = vi.fn();
    const { user } = renderWithIntl(<AdvancedHarness value={[PRICE_ROW]} onApply={onApply} />);
    await user.click(screen.getByRole('button', { name: /Satış fiyatı/ }));
    await user.type(await screen.findByRole('textbox', { name: 'En çok' }), '400');
    await user.click(screen.getByRole('button', { name: 'Uygula' }));
    expect(onApply).toHaveBeenCalledWith([
      { id: 'r-price', field: 'salePrice', operator: 'between', value: ['20', '400'] },
    ]);
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
