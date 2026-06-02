'use client';

import { type ColumnDef } from '@tanstack/react-table';
import { MoreVerticalIcon } from 'hugeicons-react';
import * as React from 'react';

import { DataTable } from '@/components/patterns/data-table';
import { DataTablePagination } from '@/components/patterns/data-table-pagination';
import { DataTableToolbar } from '@/components/patterns/data-table-toolbar';
import { Button } from '@/components/ui/button';

import { buildOrderColumns, buildShowcaseRows, type MockOrder } from './showcase-table';

// Eleven columns (the `whitespace-nowrap` identity/date cells live in the
// shared ORDER_COLUMNS) so the table's intrinsic width (~1044px) genuinely
// exceeds the constrained max-w-headline showcase frame (~894px) and overflows
// horizontally — WITHOUT that overflow there is no horizontal scroll and the
// scroll-aware pin shadow has nothing to react to (the table just stretches to
// fit and the shadow never fires). `select` (id) and `actions` (id) are what
// the DataTable auto-pin default keys off: present → pinned left / right with
// no initialColumnPinning.
const ACTIONS_COLUMN: ColumnDef<MockOrder> = {
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
};

const COLUMNS = buildOrderColumns(
  [
    'select',
    'orderNumber',
    'customer',
    'platform',
    'status',
    'orderDate',
    'grossAmount',
    'commissionAmount',
    'shippingCost',
    'netProfit',
  ],
  [ACTIONS_COLUMN],
);

function SubLabel({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
      {children}
    </span>
  );
}

export function DataTablePinningShowcase(): React.ReactElement {
  const [rows] = React.useState(() => buildShowcaseRows(20));

  return (
    <div className="gap-lg flex flex-col">
      {/* A — auto-pin: NO initialColumnPinning. `select` pins left and
          `actions` pins right by id convention (the C5 default). The
          max-w-headline (56rem) cap forces the 11-column table to overflow
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
