'use client';

import {
  type ColumnFiltersState,
  type PaginationState,
  type SortingState,
} from '@tanstack/react-table';
import * as React from 'react';

import { DataTable } from '@/components/patterns/data-table';
import { DataTablePagination } from '@/components/patterns/data-table-pagination';
import { DataTableToolbar } from '@/components/patterns/data-table-toolbar';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

import { buildOrderColumns, buildShowcaseRows, type MockOrder } from './showcase-table';

const COLUMNS = buildOrderColumns(['orderNumber', 'customer', 'status', 'netProfit']);

// Simulated "server" — a fixed dataset of 1.500 mock orders. The queryServer
// function pretends to hit an API: applies the requested search filter +
// sorting + pagination + returns the slice plus a total rowCount (what a real
// React Query hook would return from the API response).
const SERVER_ROWS = buildShowcaseRows(1500);

interface ServerQuery {
  search: string;
  sortField: 'customer' | 'netProfit' | null;
  sortDesc: boolean;
  pageIndex: number;
  pageSize: number;
}

interface ServerResponse {
  rows: MockOrder[];
  total: number;
  pageCount: number;
}

function queryServer({
  search,
  sortField,
  sortDesc,
  pageIndex,
  pageSize,
}: ServerQuery): ServerResponse {
  let rows = SERVER_ROWS;
  if (search) {
    const needle = search.toLocaleLowerCase('tr-TR');
    rows = rows.filter((row) => row.customer.toLocaleLowerCase('tr-TR').includes(needle));
  }
  if (sortField !== null) {
    rows = [...rows].sort((a, b) => {
      if (sortField === 'customer') {
        return a.customer.localeCompare(b.customer, 'tr-TR') * (sortDesc ? -1 : 1);
      }
      // sortField === 'netProfit'
      const diff = Number(a.netProfit.sub(b.netProfit));
      return diff * (sortDesc ? -1 : 1);
    });
  }
  const total = rows.length;
  const pageCount = Math.max(Math.ceil(total / pageSize), 1);
  const offset = pageIndex * pageSize;
  return { rows: rows.slice(offset, offset + pageSize), total, pageCount };
}

function sortFieldOf(sorting: SortingState): ServerQuery['sortField'] {
  const primary = sorting[0];
  if (primary?.id === 'customer') return 'customer';
  if (primary?.id === 'netProfit') return 'netProfit';
  return null;
}

const INITIAL_PARAMS: ServerQuery = {
  search: '',
  sortField: null,
  sortDesc: false,
  pageIndex: 0,
  pageSize: 50,
};

/**
 * One server-mode shell with a control that toggles how SEARCH is wired —
 * everything else (sorting / pagination → server forward, the simulated
 * round-trip, the loading derivation) is identical between the two modes, so
 * they share a single component instead of two ~90%-duplicated exports.
 *
 *   - `columnFilter`: search is a TanStack column filter (`searchColumn`). The
 *     toolbar owns the input; the value rides through `columnFilters` state.
 *   - `pageLevel`: search is page-level state (`searchValue` + `onSearchChange`)
 *     — the wiring a real nuqs URL-query page uses. The component owns the
 *     value; the toolbar is a controlled input.
 *
 * Both forward the same `ServerQuery` to `queryServer`; only the input plumbing
 * differs. `loading` is derived by comparing current params against the last
 * completed request — no setState-in-effect for the flag (React Compiler flags
 * synchronous setState in useEffect bodies as cascade-prone).
 */
type SearchMode = 'columnFilter' | 'pageLevel';

const SEARCH_MODES: { value: SearchMode; label: string }[] = [
  { value: 'columnFilter', label: 'Column filter' },
  { value: 'pageLevel', label: 'Page-level (nuqs)' },
];

export function DataTableServerModeShowcase(): React.ReactElement {
  const [searchMode, setSearchMode] = React.useState<SearchMode>('columnFilter');

  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [pageSearch, setPageSearch] = React.useState('');
  const [paginationState, setPaginationState] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: 50,
  });

  // The active search value depends on which wiring is selected.
  const columnSearch = (columnFilters.find((f) => f.id === 'customer')?.value ?? '') as string;
  const search = searchMode === 'columnFilter' ? columnSearch : pageSearch;

  const currentParams: ServerQuery = {
    search,
    sortField: sortFieldOf(sorting),
    sortDesc: sorting[0]?.desc ?? false,
    pageIndex: paginationState.pageIndex,
    pageSize: paginationState.pageSize,
  };

  // Pair the response with the params that produced it so we can derive
  // `loading` by comparing current params against the last completed request.
  const [completed, setCompleted] = React.useState<{
    params: ServerQuery;
    response: ServerResponse;
  }>(() => ({ params: INITIAL_PARAMS, response: queryServer(INITIAL_PARAMS) }));

  const loading = JSON.stringify(currentParams) !== JSON.stringify(completed.params);

  // Simulate a network round-trip whenever the controlled state changes. A real
  // consumer would replace this with a React Query hook keyed on the same
  // parameters — the DataTable wiring stays identical.
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setCompleted({ params: currentParams, response: queryServer(currentParams) });
    }, 320);
    return () => clearTimeout(timer);
    // serialised params keeps the effect from re-running when the object
    // identity changes but the values don't.
  }, [JSON.stringify(currentParams)]);

  const response = completed.response;

  const resetToFirstPage = (): void => setPaginationState((prev) => ({ ...prev, pageIndex: 0 }));

  return (
    <div className="gap-md flex flex-col">
      <ToggleGroup
        type="single"
        value={searchMode}
        onValueChange={(value) => {
          const next = SEARCH_MODES.find((mode) => mode.value === value);
          if (next !== undefined) {
            setSearchMode(next.value);
            // Clear whichever input the previous mode owned so the two never
            // fight over the same query.
            setColumnFilters([]);
            setPageSearch('');
            resetToFirstPage();
          }
        }}
        aria-label="Arama bağlama modu"
        className="self-start"
      >
        {SEARCH_MODES.map((mode) => (
          <ToggleGroupItem key={mode.value} value={mode.value}>
            {mode.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <span className="text-2xs text-muted-foreground">
        {loading ? 'Sunucudan getiriliyor…' : 'Hazır.'} &middot; aranan{' '}
        <span className="text-foreground font-mono">{search === '' ? '(boş)' : search}</span>{' '}
        &middot; toplam <span className="text-foreground font-mono">{response.total}</span> kayıt
        &middot; sayfa{' '}
        <span className="text-foreground font-mono">{paginationState.pageIndex + 1}</span> /{' '}
        <span className="text-foreground font-mono">{response.pageCount}</span>
      </span>

      <DataTable
        columns={COLUMNS}
        data={response.rows}
        getRowId={(row) => row.id}
        loading={loading && response.rows.length === 0}
        sorting={sorting}
        onSortingChange={setSorting}
        columnFilters={searchMode === 'columnFilter' ? columnFilters : undefined}
        onColumnFiltersChange={searchMode === 'columnFilter' ? setColumnFilters : undefined}
        paginationState={paginationState}
        onPaginationChange={setPaginationState}
        pageCount={response.pageCount}
        rowCount={response.total}
        toolbar={(table) =>
          searchMode === 'columnFilter' ? (
            <DataTableToolbar
              table={table}
              searchColumn="customer"
              searchPlaceholder="Müşteri ara (sunucuda filtrelenir)…"
            />
          ) : (
            <DataTableToolbar
              table={table}
              searchValue={pageSearch}
              onSearchChange={(next) => {
                setPageSearch(next);
                // Reset to first page whenever the search changes — same
                // discipline a real page-level effect on `search` would enforce.
                resetToFirstPage();
              }}
              searchPlaceholder="Müşteri ara (page-level state)…"
            />
          )
        }
        pagination={(table) => <DataTablePagination table={table} />}
      />

      <span className="text-2xs text-muted-foreground">
        Müşteri / Net kar başlıklarına tıkla → sıralama sunucuya forward edilir. Sayfa nav → fetch
        tetikler. DataTable hiçbirini kendi tarafında compute etmez (manualSorting / manualFiltering
        / manualPagination); sadece gelen slice&apos;ı ve pageCount / rowCount değerlerini render
        eder. Arama bağlama modunu yukarıdan çevir: <code>Column filter</code> TanStack column
        filter kullanır, <code>Page-level</code> ise
        <code> searchValue</code> + <code>onSearchChange</code> ile page-level state&apos;e bağlar
        (nuqs URL query gibi). İki mod mutually exclusive — aynı anda yalnızca biri besler.
      </span>
    </div>
  );
}
