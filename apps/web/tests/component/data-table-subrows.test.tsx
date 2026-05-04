import { type ColumnDef } from '@tanstack/react-table';
import { NextIntlClientProvider } from 'next-intl';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { DataTable } from '@/components/patterns/data-table';

import trMessages from '../../messages/tr.json';
import { FORMATS } from '../../src/i18n/formats';
import { render, screen } from '../helpers/render';

interface Row {
  id: string;
  label: string;
  children?: Row[];
}

const COLUMNS: ColumnDef<Row>[] = [
  {
    id: 'expand',
    cell: ({ row }) =>
      row.getCanExpand() ? (
        <button onClick={row.getToggleExpandedHandler()}>{row.getIsExpanded() ? '▾' : '▸'}</button>
      ) : null,
  },
  { id: 'label', header: 'Label', cell: ({ row }) => row.original.label },
];

const DATA: Row[] = [
  {
    id: 'p1',
    label: 'Parent 1',
    children: [
      { id: 'p1.c1', label: 'Child 1.1' },
      { id: 'p1.c2', label: 'Child 1.2' },
    ],
  },
  { id: 'p2', label: 'Parent 2' },
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

describe('DataTable with getSubRows', () => {
  it('renders sub-rows as sibling rows in the same grid when expanded', async () => {
    const { user } = renderWithIntl(
      <DataTable
        columns={COLUMNS}
        data={DATA}
        getRowId={(row) => row.id}
        getSubRows={(row) => row.children}
        getRowCanExpand={(row) => (row.original.children?.length ?? 0) > 0}
      />,
    );
    // Children not visible until parent is expanded
    expect(screen.queryByText('Child 1.1')).toBeNull();
    await user.click(screen.getByRole('button', { name: '▸' }));
    expect(screen.getByText('Child 1.1')).toBeInTheDocument();
    expect(screen.getByText('Child 1.2')).toBeInTheDocument();
    // Sub-rows tagged with data-depth="1" so feature CSS can style them
    const childRow = screen.getByText('Child 1.1').closest('tr');
    expect(childRow?.getAttribute('data-depth')).toBe('1');
    // Parent row has no data-depth (depth 0)
    const parentRow = screen.getByText('Parent 1').closest('tr');
    expect(parentRow?.getAttribute('data-depth')).toBeNull();
  });
});
