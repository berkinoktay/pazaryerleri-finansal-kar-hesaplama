'use client';

import { Delete02Icon, Edit02Icon, ViewIcon } from 'hugeicons-react';
import * as React from 'react';
import { toast } from 'sonner';

import { DataTable } from '@/components/patterns/data-table';
import { DataTablePagination } from '@/components/patterns/data-table-pagination';
import { createRowActionsColumn } from '@/components/patterns/data-table-row-actions';

import { buildOrderColumns, buildShowcaseRows, type MockOrder } from './showcase-table';

const ROW_ACTIONS_COLUMN = createRowActionsColumn<MockOrder>([
  {
    label: 'Detayları gör',
    icon: <ViewIcon />,
    onSelect: (row) => toast.info(`${row.orderNumber} detayı açıldı`),
  },
  {
    label: 'Düzenle',
    icon: <Edit02Icon />,
    onSelect: (row) => toast.info(`${row.orderNumber} düzenleniyor`),
  },
  {
    label: 'Sil',
    icon: <Delete02Icon />,
    tone: 'destructive',
    separatorBefore: true,
    onSelect: (row) => toast.error(`${row.orderNumber} silindi`),
  },
]);

// Full interactive column set: select left, kebab actions right.
const COLUMNS = buildOrderColumns(
  ['select', 'orderNumber', 'customer', 'status', 'netProfit'],
  [ROW_ACTIONS_COLUMN],
);

// Passive variant — the four data columns only (no select, no actions).
const PASSIVE_COLUMNS = buildOrderColumns(['orderNumber', 'customer', 'status', 'netProfit']);

export function DataTableRowClickShowcase(): React.ReactElement {
  const [rows] = React.useState(() => buildShowcaseRows(8));
  const [lastOpened, setLastOpened] = React.useState<string | null>(null);

  return (
    <div className="gap-lg flex flex-col">
      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Satıra tıklayınca detay açılır — checkbox / menu butonları tıklamayı yutmaz
        </span>
        {/* No initialColumnPinning: DataTable auto-pins the `select` column
            left and the `actions` column right by id convention, so the
            checkbox + kebab stay put while the middle columns scroll. */}
        <DataTable
          columns={COLUMNS}
          data={rows}
          getRowId={(row) => row.id}
          enableRowSelection
          onRowClick={(row) => {
            setLastOpened(row.orderNumber);
            toast.success(`${row.orderNumber} detayı açıldı`);
          }}
          pagination={(table) => <DataTablePagination table={table} />}
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
        <DataTable columns={PASSIVE_COLUMNS} data={rows.slice(0, 4)} getRowId={(row) => row.id} />
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
