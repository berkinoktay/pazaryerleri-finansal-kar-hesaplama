'use client';

import {
  type ColumnDef,
  type ColumnFiltersState,
  type PaginationState,
  type SortingState,
} from '@tanstack/react-table';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { DataTable } from '@/components/patterns/data-table';
import { DataTablePagination } from '@/components/patterns/data-table-pagination';
import { DataTableToolbar } from '@/components/patterns/data-table-toolbar';
import { Badge } from '@/components/ui/badge';
import { buildMockOrders, type MockOrder } from '@/components/showcase/showcase-mocks';

const STATUS_TONE: Record<MockOrder['status'], 'success' | 'info' | 'warning' | 'destructive'> = {
  delivered: 'success',
  shipped: 'info',
  pending: 'warning',
  returned: 'destructive',
};

const STATUS_LABEL: Record<MockOrder['status'], string> = {
  delivered: 'Teslim',
  shipped: 'Kargoda',
  pending: 'Bekleyen',
  returned: 'İade',
};

const COLUMNS: ColumnDef<MockOrder>[] = [
  {
    accessorKey: 'orderNumber',
    header: 'Sipariş No',
    cell: ({ row }) => (
      <span className="text-foreground font-mono text-xs">{row.original.orderNumber}</span>
    ),
  },
  { accessorKey: 'customer', header: 'Müşteri' },
  {
    accessorKey: 'status',
    header: 'Durum',
    cell: ({ row }) => (
      <Badge tone={STATUS_TONE[row.original.status]}>{STATUS_LABEL[row.original.status]}</Badge>
    ),
  },
  {
    accessorKey: 'netProfit',
    header: 'Net kar',
    meta: { numeric: true },
    cell: ({ row }) => <Currency value={row.original.netProfit} emphasis />,
  },
];

// Simulated "server" — a fixed dataset of 1.500 mock orders. The
// queryServer function pretends to hit an API: applies the requested
// search filter + sorting + pagination + returns the slice plus a
// total rowCount (what a real React Query hook would return from the
// API response).
const SERVER_ROWS = buildMockOrders(1500);

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

function deriveQueryParams(
  sorting: SortingState,
  columnFilters: ColumnFiltersState,
  paginationState: PaginationState,
): ServerQuery {
  const search = (columnFilters.find((f) => f.id === 'customer')?.value ?? '') as string;
  const primarySort = sorting[0];
  const sortField =
    primarySort?.id === 'customer'
      ? 'customer'
      : primarySort?.id === 'netProfit'
        ? 'netProfit'
        : null;
  return {
    search,
    sortField,
    sortDesc: primarySort?.desc ?? false,
    pageIndex: paginationState.pageIndex,
    pageSize: paginationState.pageSize,
  };
}

const INITIAL_PARAMS = deriveQueryParams([], [], { pageIndex: 0, pageSize: 50 });

export function DataTableServerModeShowcase(): React.ReactElement {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [paginationState, setPaginationState] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: 50,
  });
  // Pair the response with the params that produced it so we can derive
  // `loading` by comparing current params against the last completed
  // request — no setState-in-effect for the loading flag (React Compiler
  // flags synchronous setState in useEffect bodies as cascade-prone).
  const [completed, setCompleted] = React.useState<{
    params: ServerQuery;
    response: ServerResponse;
  }>(() => ({ params: INITIAL_PARAMS, response: queryServer(INITIAL_PARAMS) }));

  const currentParams = deriveQueryParams(sorting, columnFilters, paginationState);
  const loading = JSON.stringify(currentParams) !== JSON.stringify(completed.params);

  // Simulate a network round-trip whenever the controlled state changes.
  // A real consumer would replace this with a React Query hook keyed on
  // the same parameters — the DataTable wiring stays identical.
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setCompleted({ params: currentParams, response: queryServer(currentParams) });
    }, 320);
    return () => clearTimeout(timer);

    // serialised params keeps the effect from re-running when the object
    // identity changes but the values don't.
  }, [JSON.stringify(currentParams)]);

  const response = completed.response;

  return (
    <div className="gap-md flex flex-col">
      <span className="text-2xs text-muted-foreground">
        {loading ? 'Sunucudan getiriliyor…' : 'Hazır.'} &middot; toplam{' '}
        <span className="text-foreground font-mono">{response.total}</span> kayıt &middot; sayfa{' '}
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
        columnFilters={columnFilters}
        onColumnFiltersChange={setColumnFilters}
        paginationState={paginationState}
        onPaginationChange={setPaginationState}
        pageCount={response.pageCount}
        rowCount={response.total}
        toolbar={(table) => (
          <DataTableToolbar
            table={table}
            searchColumn="customer"
            searchPlaceholder="Müşteri ara (sunucuda filtrelenir)…"
          />
        )}
        pagination={(table) => <DataTablePagination table={table} />}
      />
      <span className="text-2xs text-muted-foreground">
        Müşteri / Net kar başlıklarına tıkla → sıralama sunucuya forward edilir. Müşteri ara kutusu
        → filtre sunucuya forward edilir. Sayfa nav → fetch tetikler. DataTable hiçbirini kendi
        tarafında compute etmez (manualSorting / manualFiltering / manualPagination); sadece gelen
        slice&apos;ı ve pageCount / rowCount değerlerini render eder.
      </span>
    </div>
  );
}
