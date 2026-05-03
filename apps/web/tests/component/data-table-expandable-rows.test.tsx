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
  name: string;
  expandable: boolean;
}

const COLUMNS: ColumnDef<Row>[] = [
  {
    id: 'expand',
    enableSorting: false,
    cell: ({ row }) => {
      if (!row.getCanExpand()) return null;
      return (
        <button
          type="button"
          onClick={row.getToggleExpandedHandler()}
          aria-label={row.getIsExpanded() ? 'Kapat' : 'Aç'}
        >
          {row.getIsExpanded() ? '▼' : '▶'}
        </button>
      );
    },
  },
  { accessorKey: 'name', header: 'Name' },
];

const ROWS: Row[] = [
  { id: '1', name: 'expandable row', expandable: true },
  { id: '2', name: 'plain row', expandable: false },
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

describe('DataTable expandable rows', () => {
  it('renders the expand toggle only on rows where getRowCanExpand returns true', () => {
    renderWithIntl(
      <DataTable
        columns={COLUMNS}
        data={ROWS}
        getRowId={(r) => r.id}
        getRowCanExpand={(row) => row.original.expandable}
        renderSubComponent={(row) => <div>Sub: {row.original.name}</div>}
      />,
    );
    // Only the expandable row's toggle is rendered.
    expect(screen.getAllByRole('button', { name: 'Aç' })).toHaveLength(1);
  });

  it('renders the sub-component beneath an expanded row when toggled', async () => {
    const { user } = renderWithIntl(
      <DataTable
        columns={COLUMNS}
        data={ROWS}
        getRowId={(r) => r.id}
        getRowCanExpand={(row) => row.original.expandable}
        renderSubComponent={(row) => (
          <div data-testid={`sub-${row.original.id}`}>Sub: {row.original.name}</div>
        )}
      />,
    );
    // Initially collapsed — sub-component not in DOM.
    expect(screen.queryByTestId('sub-1')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Aç' }));
    // After toggle, the sub-component renders.
    expect(screen.getByTestId('sub-1')).toBeInTheDocument();
    expect(screen.getByText('Sub: expandable row')).toBeInTheDocument();
  });

  it('marks expanded sub-rows with data-expanded-content for styling hooks', async () => {
    const { container, user } = renderWithIntl(
      <DataTable
        columns={COLUMNS}
        data={ROWS}
        getRowId={(r) => r.id}
        getRowCanExpand={(row) => row.original.expandable}
        renderSubComponent={(row) => <div>Sub: {row.original.name}</div>}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Aç' }));
    const expandedRow = container.querySelector('tr[data-expanded-content="true"]');
    expect(expandedRow).not.toBeNull();
  });

  it('does not render any sub-component when renderSubComponent is omitted', () => {
    renderWithIntl(
      <DataTable
        columns={COLUMNS}
        data={ROWS}
        getRowId={(r) => r.id}
        getRowCanExpand={(row) => row.original.expandable}
        // renderSubComponent intentionally omitted
      />,
    );
    expect(screen.queryAllByText(/^Sub: /)).toHaveLength(0);
  });
});
