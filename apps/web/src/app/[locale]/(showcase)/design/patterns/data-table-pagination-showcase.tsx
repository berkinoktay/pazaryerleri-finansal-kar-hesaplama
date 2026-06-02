'use client';

import {
  type ColumnDef,
  type PaginationState,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
} from '@tanstack/react-table';
import * as React from 'react';

import { DataTablePagination } from '@/components/patterns/data-table-pagination';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface OrderRow {
  orderNumber: string;
  customer: string;
}

const COLUMNS: ColumnDef<OrderRow>[] = [
  { accessorKey: 'orderNumber', header: 'Sipariş No' },
  { accessorKey: 'customer', header: 'Müşteri' },
];

function buildOrders(n: number, offset = 0): OrderRow[] {
  const FIRST_NAMES = ['Ayşe', 'Mehmet', 'Zeynep', 'Emre', 'Selin', 'Burak', 'Deniz', 'Cem'];
  const LAST_NAMES = ['Yılmaz', 'Kaya', 'Demir', 'Çelik', 'Şahin', 'Aydın', 'Öztürk', 'Doğan'];
  return Array.from({ length: n }, (_, i) => {
    const idx = offset + i;
    return {
      orderNumber: `TY-${String(2940000 + idx).padStart(7, '0')}`,
      customer: `${FIRST_NAMES[idx % FIRST_NAMES.length]} ${LAST_NAMES[(idx >> 3) % LAST_NAMES.length]}`,
    };
  });
}

function MiniTable<TData>({ table }: { table: ReturnType<typeof useReactTable<TData>> }) {
  return (
    <div className="border-border bg-card overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id}>
              {hg.headers.map((h) => (
                <TableHead key={h.id}>
                  {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={COLUMNS.length}
                className="text-muted-foreground py-md text-center text-sm"
              >
                Filtre eşleşmedi.
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function DefaultExample(): React.ReactElement {
  const [data] = React.useState(() => buildOrders(50));
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  });
  const table = useReactTable({
    data,
    columns: COLUMNS,
    state: { pagination },
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });
  return (
    <div className="gap-md flex flex-col">
      <MiniTable table={table} />
      <DataTablePagination table={table} />
    </div>
  );
}

function CustomPageSizesExample(): React.ReactElement {
  const [data] = React.useState(() => buildOrders(120));
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: 15,
  });
  const table = useReactTable({
    data,
    columns: COLUMNS,
    state: { pagination },
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });
  return (
    <div className="gap-md flex flex-col">
      <MiniTable table={table} />
      <DataTablePagination table={table} pageSizes={[5, 15, 30, 60]} />
    </div>
  );
}

function EmptyExample(): React.ReactElement {
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  });
  const table = useReactTable({
    data: [],
    columns: COLUMNS,
    state: { pagination },
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });
  return (
    <div className="gap-md flex flex-col">
      <MiniTable table={table} />
      <DataTablePagination table={table} />
    </div>
  );
}

export function DataTablePaginationShowcase(): React.ReactElement {
  return (
    <div className="gap-lg flex flex-col">
      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Default — 50 satır, sayfa başına 10
        </span>
        <DefaultExample />
        <span className="text-2xs text-muted-foreground">
          Solda satır özeti (1–10 / 50), sağda perPage [10, 25, 50] + sayfa caption + ilk / önceki /
          sonraki / son. Sınırlarda ilgili düğmeler disable.
        </span>
      </div>

      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          pageSizes prop&apos;u — özel seçenek listesi
        </span>
        <CustomPageSizesExample />
        <span className="text-2xs text-muted-foreground">
          Default [10, 25, 50] yerine [5, 15, 30, 60]. 120 satır + initialPageSize 15 ile
          başlatıldı.
        </span>
      </div>

      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Boş seri — &quot;0 / 0 satır&quot;, tüm nav disabled
        </span>
        <EmptyExample />
        <span className="text-2xs text-muted-foreground">
          Filtre eşleşmediğinde &quot;Sayfa 1 / 1&quot; graceful fallback (pageCount 0&apos;a
          düşmez); perPage Select hâlâ erişilebilir.
        </span>
      </div>

      <p className="text-2xs text-muted-foreground">
        Server-side mode (manualPagination + pageCount + rowCount) için &quot;Sayfalama &amp; sunucu
        modu&quot; bölümündeki Sunucu modu demosuna bak — aynı pagination UI&apos;ı, slice
        parent&apos;tan fetch edilir.
      </p>
    </div>
  );
}
