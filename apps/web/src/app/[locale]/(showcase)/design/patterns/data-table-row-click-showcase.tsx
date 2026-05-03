'use client';

import { type ColumnDef } from '@tanstack/react-table';
import { ArrowDown01Icon } from 'hugeicons-react';
import * as React from 'react';
import { toast } from 'sonner';

import { Currency } from '@/components/patterns/currency';
import { DataTable } from '@/components/patterns/data-table';
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
    enableSorting: false,
    enableHiding: false,
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
      <span className="text-foreground font-mono text-xs">{row.original.orderNumber}</span>
    ),
  },
  {
    accessorKey: 'customer',
    header: 'Müşteri',
  },
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
  {
    id: 'actions',
    enableSorting: false,
    enableHiding: false,
    header: () => <span className="sr-only">İşlemler</span>,
    cell: ({ row }) => (
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`${row.original.orderNumber} menüsü`}
        onClick={() => toast.info(`${row.original.orderNumber} menüsü açıldı`)}
      >
        <ArrowDown01Icon className="size-icon-sm" />
      </Button>
    ),
  },
];

export function DataTableRowClickShowcase(): React.ReactElement {
  const [rows] = React.useState(() => buildMockOrders(8));
  const [lastOpened, setLastOpened] = React.useState<string | null>(null);

  return (
    <div className="gap-lg flex flex-col">
      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Satıra tıklayınca detay açılır — checkbox / menu butonları tıklamayı yutmaz
        </span>
        <DataTable
          columns={COLUMNS}
          data={rows}
          getRowId={(row) => row.id}
          enableRowSelection
          onRowClick={(row) => {
            setLastOpened(row.orderNumber);
            toast.success(`${row.orderNumber} detayı açıldı`);
          }}
        />
        <span className="text-2xs text-muted-foreground">
          Son açılan: <span className="text-foreground font-mono">{lastOpened ?? '—'}</span>
          &nbsp;&middot; Klavyeden Tab ile satıra geç, Enter veya Space ile aktif et. Checkbox /
          actions buttonu tıklayınca sadece o işlem çalışır, satır handler&apos;ı tetiklenmez.
        </span>
      </div>

      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          onRowClick atlanırsa — pasif satırlar (eski davranış)
        </span>
        <DataTable
          columns={COLUMNS.slice(1, 5)}
          data={rows.slice(0, 4)}
          getRowId={(row) => row.id}
        />
        <span className="text-2xs text-muted-foreground">
          Aynı tablo, onRowClick yok. Satır role / tabIndex / cursor / focus ring almaz — eski
          tüketicilerle birebir uyumlu.
        </span>
      </div>

      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          data-row-action opt-out
        </span>
        <span className="text-2xs text-muted-foreground">
          Tıklanabilir özel bir öğen varsa (örn. styled span, klavye-gezinmesi olmayan custom
          control) ve satır handler&apos;ını tetiklemesini istemiyorsan, üzerine{' '}
          <code className="bg-muted px-3xs py-3xs rounded-sm font-mono text-xs">
            data-row-action
          </code>{' '}
          attribute&apos;ü ekle. button / a / input / label / role=
          {`{button|checkbox|menuitem|link|switch|tab|option}`} zaten otomatik atlanıyor.
        </span>
      </div>
    </div>
  );
}
