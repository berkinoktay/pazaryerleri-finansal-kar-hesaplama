import { type ColumnDef, getCoreRowModel, useReactTable } from '@tanstack/react-table';
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
