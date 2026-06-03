'use client';

import * as React from 'react';
import { toast } from 'sonner';

import { DataTable } from '@/components/patterns/data-table';
import { DataTablePagination } from '@/components/patterns/data-table-pagination';
import { DataTableToolbar } from '@/components/patterns/data-table-toolbar';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

import { buildOrderColumns, buildShowcaseRows } from './showcase-table';

/**
 * Interactive demo of DataTable's four body states resolved by its precedence
 * ladder (loading → error → no-results → first-run → rows). One ToggleGroup
 * flips between them against a SINGLE table — self-contained state, so toggling
 * never re-renders the rest of the (table-heavy) showcase page.
 *
 * This is a BEHAVIOR demo (live state machine), not a static prop grid — it
 * stays a Preview-mounted component rather than collapsing into a Playground.
 */

type StateKey = 'rows' | 'loading' | 'firstRun' | 'noResults' | 'error';

const STATE_OPTIONS: { key: StateKey; label: string }[] = [
  { key: 'rows', label: 'Dolu' },
  { key: 'loading', label: 'Yükleniyor' },
  { key: 'firstRun', label: 'İlk kurulum' },
  { key: 'noResults', label: 'Sonuç yok' },
  { key: 'error', label: 'Hata' },
];

const columns = buildOrderColumns(['orderNumber', 'customer', 'platform', 'status', 'netProfit']);

export function DataTableStatesShowcase(): React.ReactElement {
  const [state, setState] = React.useState<StateKey>('rows');
  const rows = React.useMemo(() => buildShowcaseRows(6), []);
  const data = state === 'rows' ? rows : [];

  return (
    <div className="gap-md flex flex-col">
      <ToggleGroup
        type="single"
        value={state}
        onValueChange={(value) => {
          // Ignore the empty string Radix emits when the active item is clicked
          // again — a state switcher should always keep a selection. find()
          // also narrows the string back to StateKey without a type assertion.
          const next = STATE_OPTIONS.find((option) => option.key === value);
          if (next !== undefined) setState(next.key);
        }}
        aria-label="Tablo durumu"
        className="self-start"
      >
        {STATE_OPTIONS.map((option) => (
          <ToggleGroupItem key={option.key} value={option.key}>
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <DataTable
        columns={columns}
        data={data}
        getRowId={(row) => row.id}
        loading={state === 'loading'}
        error={state === 'error'}
        onRetry={() => toast.info('Yeniden deneniyor… (mock)')}
        hasActiveFilters={state === 'noResults'}
        onClearFilters={() => setState('rows')}
        toolbar={(table) => (
          <DataTableToolbar
            table={table}
            searchColumn="customer"
            searchPlaceholder="Müşteri ara..."
          />
        )}
        pagination={(table) => <DataTablePagination table={table} />}
      />
    </div>
  );
}
