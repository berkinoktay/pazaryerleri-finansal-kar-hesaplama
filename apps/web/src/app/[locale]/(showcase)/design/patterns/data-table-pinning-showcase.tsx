'use client';

import { type ColumnDef } from '@tanstack/react-table';
import { ArrowDown01Icon } from 'hugeicons-react';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { DataTable } from '@/components/patterns/data-table';
import { DataTablePagination } from '@/components/patterns/data-table-pagination';
import { DataTableToolbar } from '@/components/patterns/data-table-toolbar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
    id: 'select',
    enableHiding: false,
    enableSorting: false,
    enablePinning: true,
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && 'indeterminate')
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="Tümünü seç"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label="Satırı seç"
      />
    ),
  },
  {
    accessorKey: 'orderNumber',
    header: 'Sipariş No',
    cell: ({ row }) => (
      <span className="text-foreground font-mono text-xs whitespace-nowrap">
        {row.original.orderNumber}
      </span>
    ),
  },
  {
    accessorKey: 'customer',
    header: 'Müşteri',
    cell: ({ row }) => <span className="whitespace-nowrap">{row.original.customer}</span>,
  },
  {
    accessorKey: 'platform',
    header: 'Pazaryeri',
    cell: ({ row }) => (
      <Badge tone="outline">
        {row.original.platform === 'TRENDYOL' ? 'Trendyol' : 'Hepsiburada'}
      </Badge>
    ),
  },
  {
    accessorKey: 'status',
    header: 'Durum',
    cell: ({ row }) => (
      <Badge tone={STATUS_TONE[row.original.status]}>{STATUS_LABEL[row.original.status]}</Badge>
    ),
  },
  {
    accessorKey: 'grossAmount',
    header: 'Ciro',
    meta: { numeric: true },
    cell: ({ row }) => <Currency value={row.original.grossAmount} />,
  },
  {
    accessorKey: 'commissionAmount',
    header: 'Komisyon',
    meta: { numeric: true },
    cell: ({ row }) => (
      <Currency value={row.original.commissionAmount} className="text-muted-foreground" />
    ),
  },
  {
    accessorKey: 'netProfit',
    header: 'Net kar',
    meta: { numeric: true },
    cell: ({ row }) => <Currency value={row.original.netProfit} emphasis />,
  },
  {
    id: 'actions',
    enableHiding: false,
    enableSorting: false,
    enablePinning: true,
    header: () => <span className="sr-only">İşlemler</span>,
    cell: () => (
      <Button variant="ghost" size="icon-sm" aria-label="Sipariş menüsü">
        <ArrowDown01Icon className="size-icon-sm" />
      </Button>
    ),
  },
];

export function DataTablePinningShowcase(): React.ReactElement {
  const [rows] = React.useState(() => buildMockOrders(20));

  return (
    <div className="gap-lg flex flex-col">
      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Initial pinning — `select` + `orderNumber` solda, `actions` sağda
        </span>
        {/* max-w-headline (56rem) keeps the showcase narrow enough that the
            9-column table genuinely overflows and you can see the pinned
            edges + shadow during horizontal scroll. */}
        <div className="max-w-headline">
          <DataTable
            columns={COLUMNS}
            data={rows}
            getRowId={(row) => row.id}
            enableRowSelection
            initialColumnPinning={{ left: ['select', 'orderNumber'], right: ['actions'] }}
            toolbar={(table) => <DataTableToolbar table={table} searchColumn="customer" />}
            pagination={(table) => <DataTablePagination table={table} />}
          />
        </div>
        <span className="text-2xs text-muted-foreground">
          Yatay olarak kaydır — sol pinli kolonlar yerinde kalır, sağ pinli `actions` da. Açık
          sınırda `data-pinned-edge` ile pin-edge gölgesi görünür. Hover ve seçim durumu pinli
          hücrelere de yansır (group/row CSS kontratı sayesinde).
        </span>
      </div>

      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Pin / Unpin toolbar&apos;dan
        </span>
        <span className="text-2xs text-muted-foreground">
          Sağ üstteki kolon yönetimi menüsünü aç → her kolonun yanında iki minik buton: sola pin
          (←|) ve sağa pin (|→). aria-pressed ile aktif tarafı işaretler. Yeniden tıklamak unpin
          eder. Görünürlük checkbox&apos;ı ile bağımsız çalışır.
        </span>
      </div>
    </div>
  );
}
