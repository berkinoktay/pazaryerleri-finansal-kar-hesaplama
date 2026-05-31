'use client';

import { type ColumnDef } from '@tanstack/react-table';
import { MoreVerticalIcon } from 'hugeicons-react';
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

// Eleven columns (with `whitespace-nowrap` identity/date cells) so the
// table's intrinsic width (~1044px) genuinely exceeds the constrained
// max-w-headline showcase frame (~894px) and overflows horizontally —
// WITHOUT that overflow there is no horizontal scroll and the scroll-aware
// pin shadow has nothing to react to (the table just stretches to fit and
// the shadow never fires). `select` (id) and `actions` (id) are what the
// DataTable auto-pin default keys off: present → pinned left / right with
// no initialColumnPinning.
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
      <Badge variant="outline">
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
    accessorKey: 'orderDate',
    header: 'Tarih',
    cell: ({ row }) => (
      <span className="text-muted-foreground text-xs whitespace-nowrap">
        {row.original.orderDate.slice(0, 10)}
      </span>
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
    accessorKey: 'shippingCost',
    header: 'Kargo',
    meta: { numeric: true },
    cell: ({ row }) => (
      <Currency value={row.original.shippingCost} className="text-muted-foreground" />
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
        <MoreVerticalIcon className="size-icon-sm" />
      </Button>
    ),
  },
];

function SubLabel({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
      {children}
    </span>
  );
}

export function DataTablePinningShowcase(): React.ReactElement {
  const [rows] = React.useState(() => buildMockOrders(20));

  return (
    <div className="gap-lg flex flex-col">
      {/* A — auto-pin: NO initialColumnPinning. `select` pins left and
          `actions` pins right by id convention (the C5 default). The
          max-w-headline (56rem) cap forces the 9-column table to overflow
          so the scroll-aware edge shadow is actually exercisable. */}
      <div className="gap-3xs flex flex-col">
        <SubLabel>Otomatik sabitleme — initialColumnPinning yok</SubLabel>
        <div className="max-w-headline">
          <DataTable
            columns={COLUMNS}
            data={rows}
            getRowId={(row) => row.id}
            enableRowSelection
            toolbar={(table) => <DataTableToolbar table={table} searchColumn="customer" />}
            pagination={(table) => <DataTablePagination table={table} />}
          />
        </div>
        <p className="text-2xs text-muted-foreground">
          <span className="text-foreground font-medium">← Yatay kaydır →</span> · `select` kolonu
          kendiliğinden solda, `actions` kendiliğinden sağda sabitlenir (id kuralı; hiç config
          geçmedik). Pin-edge gölgesi <span className="text-foreground">scroll-duyarlı</span>: en
          başta sol gölge yok, kaydırınca belirir; en sona varınca sağ gölge kaybolur. Hover + seçim
          durumu pinli hücrelere de yansır.
        </p>
      </div>

      {/* B — explicit override: an initialColumnPinning replaces the auto
          default wholesale, so a feature can add its own anchor column. */}
      <div className="gap-3xs flex flex-col">
        <SubLabel>Elle sabitleme — initialColumnPinning override</SubLabel>
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
        <p className="text-2xs text-muted-foreground">
          `orderNumber`&apos;ı da sola ekledik. Explicit `initialColumnPinning` auto-default&apos;u
          tamamen değiştirir — otomatik mod yalnızca hiç config yokken devreye girer.
        </p>
      </div>

      {/* C — runtime pin/unpin via the toolbar column menu (text only;
          the live controls sit inside example A's toolbar). */}
      <div className="gap-3xs flex flex-col">
        <SubLabel>Toolbar&apos;dan pin / unpin</SubLabel>
        <p className="text-2xs text-muted-foreground">
          Yukarıdaki tablonun sağ üstündeki kolon yönetimi menüsünü aç → her kolonun yanında sola
          pin (←|) ve sağa pin (|→) butonu. aria-pressed aktif tarafı işaretler; yeniden tıklamak
          unpin eder. Görünürlük checkbox&apos;ı ile bağımsız çalışır.
        </p>
      </div>
    </div>
  );
}
