import { type ColumnDef, type ColumnPinningState } from '@tanstack/react-table';
import { NextIntlClientProvider } from 'next-intl';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DataTable } from '@/components/patterns/data-table';
import { DataTableToolbar } from '@/components/patterns/data-table-toolbar';

import trMessages from '../../messages/tr.json';
import { FORMATS } from '../../src/i18n/formats';
import { render, screen, within } from '../helpers/render';

interface Row {
  id: string;
  a: string;
  b: string;
  c: string;
  d: string;
}

const COLUMNS: ColumnDef<Row>[] = [
  { accessorKey: 'a', header: 'A' },
  { accessorKey: 'b', header: 'B' },
  { accessorKey: 'c', header: 'C' },
  { accessorKey: 'd', header: 'D' },
];

const ROWS: Row[] = [
  { id: '1', a: 'a1', b: 'b1', c: 'c1', d: 'd1' },
  { id: '2', a: 'a2', b: 'b2', c: 'c2', d: 'd2' },
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

describe('DataTable column pinning', () => {
  describe('initialColumnPinning', () => {
    it('marks pinned cells with data-pinned-side', () => {
      const { container } = renderWithIntl(
        <DataTable
          columns={COLUMNS}
          data={ROWS}
          getRowId={(r) => r.id}
          initialColumnPinning={{ left: ['a', 'b'], right: ['d'] }}
        />,
      );
      // Expect 2 left-pinned cells per row (a, b) + their headers, plus
      // 1 right-pinned per row (d) + its header.
      const leftPinnedCells = container.querySelectorAll('[data-pinned-side="left"]');
      const rightPinnedCells = container.querySelectorAll('[data-pinned-side="right"]');
      // 2 rows × 2 left-pinned cols + 1 header row × 2 left-pinned ths = 6
      expect(leftPinnedCells.length).toBe(6);
      // 2 rows × 1 right-pinned col + 1 header row × 1 right-pinned th = 3
      expect(rightPinnedCells.length).toBe(3);
    });

    it('flags the last left-pinned column with data-pinned-edge="last-left"', () => {
      const { container } = renderWithIntl(
        <DataTable
          columns={COLUMNS}
          data={ROWS}
          getRowId={(r) => r.id}
          initialColumnPinning={{ left: ['a', 'b'], right: [] }}
        />,
      );
      // Edge marker should land only on column "b" (last left), not "a".
      const edgeCells = container.querySelectorAll('[data-pinned-edge="last-left"]');
      // 1 header + 2 body rows for column "b" = 3
      expect(edgeCells.length).toBe(3);
      // None of column "a"'s cells should carry the edge marker.
      for (const el of edgeCells) {
        expect(el.textContent).not.toContain('a');
      }
    });

    it('flags the first right-pinned column with data-pinned-edge="first-right"', () => {
      const { container } = renderWithIntl(
        <DataTable
          columns={COLUMNS}
          data={ROWS}
          getRowId={(r) => r.id}
          initialColumnPinning={{ left: [], right: ['c', 'd'] }}
        />,
      );
      const edgeCells = container.querySelectorAll('[data-pinned-edge="first-right"]');
      // 1 header + 2 body rows for first-right column "c" = 3
      expect(edgeCells.length).toBe(3);
    });

    it('emits inline left/right offset styles on pinned cells', () => {
      const { container } = renderWithIntl(
        <DataTable
          columns={COLUMNS}
          data={ROWS}
          getRowId={(r) => r.id}
          initialColumnPinning={{ left: ['a'], right: ['d'] }}
        />,
      );
      const leftPinned = container.querySelector('td[data-pinned-side="left"]') as HTMLElement;
      expect(leftPinned).not.toBeNull();
      // First left-pinned column → offset 0 (no earlier pinned columns).
      expect(leftPinned.style.left).toBe('0px');

      const rightPinned = container.querySelector('td[data-pinned-side="right"]') as HTMLElement;
      expect(rightPinned).not.toBeNull();
      expect(rightPinned.style.right).toBe('0px');
    });
  });

  describe('controlled column pinning', () => {
    it('respects supplied columnPinning state and reports changes', async () => {
      const onChange = vi.fn();
      function Harness() {
        const [pinning, setPinning] = React.useState<ColumnPinningState>({
          left: ['a'],
          right: [],
        });
        return (
          <DataTable
            columns={COLUMNS}
            data={ROWS}
            getRowId={(r) => r.id}
            columnPinning={pinning}
            onColumnPinningChange={(updater) => {
              const next = typeof updater === 'function' ? updater(pinning) : updater;
              onChange(next);
              setPinning(next);
            }}
            toolbar={(table) => <DataTableToolbar table={table} />}
          />
        );
      }
      const { user, container } = renderWithIntl(<Harness />);
      // Open the column-management dropdown.
      await user.click(screen.getByRole('button', { name: 'Kolonları düzenle' }));
      // Click "Sağa sabitle" for column "b".
      const bRowLabel = await screen.findByText('b');
      const bRow = bRowLabel.closest('[role="menuitem"]') as HTMLElement;
      const pinRightBtn = within(bRow).getByRole('button', { name: 'Sağa sabitle' });
      await user.click(pinRightBtn);
      // The pinning callback should have fired with column b on the right.
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ right: expect.arrayContaining(['b']) }),
      );
      // After the state update, the table should mark column b as right-pinned.
      const rightPinnedHeads = container.querySelectorAll('th[data-pinned-side="right"]');
      expect(rightPinnedHeads.length).toBeGreaterThan(0);
    });
  });

  describe('uncontrolled (default) mode', () => {
    it('starts with no pinned columns when no initial state is supplied', () => {
      const { container } = renderWithIntl(
        <DataTable columns={COLUMNS} data={ROWS} getRowId={(r) => r.id} />,
      );
      expect(container.querySelectorAll('[data-pinned-side]').length).toBe(0);
    });
  });
});
