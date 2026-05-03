'use client';

import { type ColumnDef } from '@tanstack/react-table';
import * as React from 'react';
import { toast } from 'sonner';

import { Currency } from '@/components/patterns/currency';
import { DataTable } from '@/components/patterns/data-table';
import { DataTablePagination } from '@/components/patterns/data-table-pagination';
import { DataTableToolbar } from '@/components/patterns/data-table-toolbar';
import { PageHeader } from '@/components/patterns/page-header';
import { Preview } from '@/components/showcase/preview';

import { BulkActionBarShowcase } from '../patterns/bulk-action-bar-showcase';
import { DataTablePaginationShowcase } from '../patterns/data-table-pagination-showcase';
import { DataTablePinningShowcase } from '../patterns/data-table-pinning-showcase';
import { DataTableRowClickShowcase } from '../patterns/data-table-row-click-showcase';
import { DataTableServerModeShowcase } from '../patterns/data-table-server-mode-showcase';
import { FilterChipGroupShowcase } from '../patterns/filter-chip-group-showcase';
import { FilterTabsShowcase } from '../patterns/filter-tabs-showcase';
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
        description="50 satır mock sipariş. Başlıklara tıklayıp sırala, satırları seç, tümünü seç, kolonları gizle/göster, sayfalar arasında gez ve sayfa başına satır sayısını değiştir."
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
          pagination={(table) => <DataTablePagination table={table} />}
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

      <Preview
        title="BulkActionBar"
        description="Seçili satırlar üstünde çoklu aksiyon. Floating mod = viewport tabanına yapışır, seçim 0'dan büyükken görünür ve fade+slide ile girer (motion-reduce honored). Inline mod = kart içinde toolbar yerine durur. Per-action tone (default / destructive) ve disabled. Bar selection state'i sahiplenmez — caller selectedCount + onClear verir."
      >
        <BulkActionBarShowcase />
      </Preview>

      <Preview
        title="FilterChipGroup"
        description="Uygulanan filtreleri pill chip'leri olarak gösterir; her chip'in kendi X'i ve opsiyonel global &quot;Tümünü temizle&quot; linki var. group + label (Durum: Aktif) ya da sadece label varyantları. Per-chip leading icon (StatusDot, MarketplaceLogo). chips=[] ise null döner — caller visibility gating yapmaz."
      >
        <FilterChipGroupShowcase />
      </Preview>

      <Preview
        title="FilterTabs"
        description="Liste / tablo üstüne oturan durum-segmenter strip. Tabs primitive üstüne sarılmış; her seçenek için count slot, locale-aware sayı formatı, undefined-count fallback (label-only), explicit zero (trust signal), loading=true → her count Skeleton. Controlled-only (URL state + nuqs ile). Default underline; pill variant constrained kart için. FilterChipGroup additive filtreler için, FilterTabs mutually-exclusive durum segmenti için."
      >
        <FilterTabsShowcase />
      </Preview>

      <Preview
        title="DataTablePagination"
        description="DataTable'ın altına oturan kanonik sayfalama altbiti. Solda &quot;1–10 / 50 satır&quot; özet, sağda perPage Select [10/25/50/100] + &quot;Sayfa X / Y&quot; caption + ilk/önceki/sonraki/son. Tüm sayılar useFormatter().number üstünden — tr-TR'de 1.472 olarak gruplanır. Server-side aware: manualPagination + pageCount/rowCount geçildiğinde aynı UI çalışır. Boş seride graceful fallback (Sayfa 1 / 1, tüm nav disabled). DataTable'ın `pagination` slot'una geçilir."
      >
        <DataTablePaginationShowcase />
      </Preview>

      <Preview
        title="Kolon sabitleme (pinning)"
        description="`initialColumnPinning` ile başlangıç durumu, ya da kontrollü `columnPinning` + `onColumnPinningChange` ile URL state. Toolbar'ın kolon yönetimi menüsünden her kolon sola / sağa pin'lenebilir. Sticky CSS + opaque arka plan + pin-edge gölgesi (--shadow-pin-left-edge / --shadow-pin-right-edge token'ları). Hover ve seçim durumu pinli hücrelere group/row CSS kontratı üstünden yansır."
      >
        <DataTablePinningShowcase />
      </Preview>

      <Preview
        title="Satır tıklama (onRowClick)"
        description="Satıra tıkla → handler tetiklenir; ama checkbox / button / link / role-bearing alt öğelere tıklamak handler'ı yutmaz. button / a / input / label / select / textarea ve role=button|checkbox|menuitem|link|switch|tab|option otomatik atlanıyor. Custom interaktif span'lar için `data-row-action` opt-out attribute'ü. onRowClick atlanırsa satırlar pasif kalır — eski tüketicilerle backwards-compatible."
      >
        <DataTableRowClickShowcase />
      </Preview>

      <Preview
        title="Server-side mode (controlled)"
        description="`sorting` + `onSortingChange`, `columnFilters` + `onColumnFiltersChange`, `paginationState` + `onPaginationChange` + `pageCount` + `rowCount` props verildiğinde DataTable kendi tarafında compute etmeyi bırakır — manualSorting / manualFiltering / manualPagination otomatik aktif olur. Caller state'i lift eder, API'ye forward eder, gelen slice'ı `data` olarak besler. UI birebir aynı; sadece kim hesaplıyor değişiyor. PR 4'ün columnPinning idiomu üç axis'e daha yayıldı."
      >
        <DataTableServerModeShowcase />
      </Preview>
    </>
  );
}
