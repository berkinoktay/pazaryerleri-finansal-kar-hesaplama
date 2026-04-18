'use client';

import { type ColumnDef } from '@tanstack/react-table';
import * as React from 'react';
import { toast } from 'sonner';

import { Currency } from '@/components/patterns/currency';
import { DataTable } from '@/components/patterns/data-table';
import { DataTableToolbar } from '@/components/patterns/data-table-toolbar';
import { PageHeader } from '@/components/patterns/page-header';
import { Preview } from '@/components/showcase/preview';
import { buildMockOrders, type MockOrder } from '@/components/showcase/showcase-mocks';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';

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

const columns: ColumnDef<MockOrder>[] = [
  {
    id: 'select',
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
    enableSorting: false,
    enableHiding: false,
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
];

export default function DataShowcasePage(): React.ReactElement {
  const [rows] = React.useState(() => buildMockOrders(50));
  const [loading, setLoading] = React.useState(false);

  return (
    <>
      <PageHeader
        title="Veri tablosu"
        intent="TanStack Table v8 üstüne oturtulmuş DataTable wrapper'ı. Toolbar search + filter + column visibility + import/export emit eder."
      />

      <Preview
        title="Canlı çalışan tablo"
        description="50 satır mock sipariş. Başlıklara tıklayıp sırala, satırları seç, tümünü seç, kolonları gizle/göster."
      >
        <DataTable
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          enableRowSelection
          toolbar={(table) => (
            <DataTableToolbar
              table={table}
              searchColumn="customer"
              searchPlaceholder="Müşteri ara..."
              onImport={() => toast.info('Import diyaloğu burada açılır')}
              onExport={(selected) =>
                toast.success(`${selected.length} kayıt dışa aktarıldı (mock)`)
              }
            />
          )}
        />
      </Preview>

      <Preview title="Yükleme iskeleti" description="loading=true → satırlar Skeleton'a dönüşür.">
        <div className="gap-xs flex flex-col">
          <button
            type="button"
            className="border-border bg-background px-sm py-3xs text-2xs hover:bg-muted self-start rounded-md border font-medium transition-colors"
            onClick={() => {
              setLoading(true);
              setTimeout(() => setLoading(false), 1600);
            }}
          >
            {loading ? 'Yükleniyor…' : '1.6 saniyelik yüklemeyi tetikle'}
          </button>
          <DataTable columns={columns.slice(1, 6)} data={rows.slice(0, 5)} loading={loading} />
        </div>
      </Preview>

      <Preview
        title="Boş durum"
        description="Filtre hiç satır eşleştirmezse DataTable otomatik empty state gösterir."
      >
        <DataTable columns={columns.slice(1, 6)} data={[]} />
      </Preview>
    </>
  );
}
