'use client';

import { type ColumnDef, type Row } from '@tanstack/react-table';
import Decimal from 'decimal.js';
import { ArrowDown01Icon, ArrowRight01Icon } from 'hugeicons-react';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { DataTable } from '@/components/patterns/data-table';
import { Badge } from '@/components/ui/badge';

interface OrderLineItem {
  productName: string;
  quantity: number;
  unitPrice: Decimal;
}

interface ExpandableOrder {
  id: string;
  orderNumber: string;
  customer: string;
  status: 'delivered' | 'shipped' | 'pending';
  total: Decimal;
  lineItems: OrderLineItem[];
}

const STATUS_TONE: Record<ExpandableOrder['status'], 'success' | 'info' | 'warning'> = {
  delivered: 'success',
  shipped: 'info',
  pending: 'warning',
};

const STATUS_LABEL: Record<ExpandableOrder['status'], string> = {
  delivered: 'Teslim',
  shipped: 'Kargoda',
  pending: 'Bekleyen',
};

const ORDERS: ExpandableOrder[] = [
  {
    id: '1',
    orderNumber: 'TY-2948021',
    customer: 'Ayşe Yılmaz',
    status: 'delivered',
    total: new Decimal('487.30'),
    lineItems: [
      {
        productName: 'iPhone 15 silikon kılıf — Şeffaf',
        quantity: 1,
        unitPrice: new Decimal('189.90'),
      },
      {
        productName: 'Bluetooth kulaklık (TWS) — Beyaz',
        quantity: 2,
        unitPrice: new Decimal('148.70'),
      },
    ],
  },
  {
    id: '2',
    orderNumber: 'TY-2948033',
    customer: 'Mehmet Kaya',
    status: 'shipped',
    total: new Decimal('219.99'),
    // Single line item — getRowCanExpand returns false, no chevron rendered.
    lineItems: [
      {
        productName: 'Powerbank 20.000 mAh — Siyah',
        quantity: 1,
        unitPrice: new Decimal('219.99'),
      },
    ],
  },
  {
    id: '3',
    orderNumber: 'TY-2948089',
    customer: 'Zeynep Demir',
    status: 'pending',
    total: new Decimal('1284.39'),
    lineItems: [
      {
        productName: 'Akıllı saat kayışı — Lacivert (42mm)',
        quantity: 1,
        unitPrice: new Decimal('239.50'),
      },
      {
        productName: 'USB-C şarj kablosu (1m) — Örgülü',
        quantity: 3,
        unitPrice: new Decimal('89.00'),
      },
      {
        productName: 'Telefon tutucu — Manyetik',
        quantity: 2,
        unitPrice: new Decimal('389.45'),
      },
    ],
  },
];

const COLUMNS: ColumnDef<ExpandableOrder>[] = [
  {
    id: 'expand',
    enableSorting: false,
    enableHiding: false,
    header: () => null,
    cell: ({ row }) => {
      if (!row.getCanExpand()) {
        // Reserve the same footprint as the chevron so single-item rows
        // line up with multi-item rows.
        return <span className="size-icon-sm inline-block" aria-hidden />;
      }
      const expanded = row.getIsExpanded();
      return (
        <button
          type="button"
          onClick={row.getToggleExpandedHandler()}
          aria-label={expanded ? 'Kalemleri kapat' : 'Kalemleri aç'}
          aria-expanded={expanded}
          className="text-muted-foreground hover:text-foreground p-3xs duration-fast hover:bg-background focus-visible:ring-ring inline-flex items-center justify-center rounded-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          {expanded ? (
            <ArrowDown01Icon className="size-icon-sm" />
          ) : (
            <ArrowRight01Icon className="size-icon-sm" />
          )}
        </button>
      );
    },
  },
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
    accessorKey: 'total',
    header: 'Toplam',
    meta: { numeric: true },
    cell: ({ row }) => <Currency value={row.original.total} emphasis />,
  },
];

function LineItemsPanel({ row }: { row: Row<ExpandableOrder> }): React.ReactElement {
  const items = row.original.lineItems;
  return (
    <div className="px-md py-sm gap-xs flex flex-col">
      <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
        Sipariş kalemleri ({items.length})
      </span>
      <div className="border-border bg-card rounded-md border">
        <table className="w-full">
          <thead>
            <tr className="border-border border-b">
              <th className="px-sm py-xs text-2xs text-muted-foreground text-left font-medium">
                Ürün
              </th>
              <th className="px-sm py-xs text-2xs text-muted-foreground text-right font-medium">
                Adet
              </th>
              <th className="px-sm py-xs text-2xs text-muted-foreground text-right font-medium">
                Birim
              </th>
              <th className="px-sm py-xs text-2xs text-muted-foreground text-right font-medium">
                Tutar
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.productName} className="border-border border-b last:border-0">
                <td className="px-sm py-xs text-foreground text-sm">{item.productName}</td>
                <td className="px-sm py-xs text-foreground text-right text-sm tabular-nums">
                  {item.quantity}
                </td>
                <td className="px-sm py-xs text-right">
                  <Currency value={item.unitPrice} className="text-muted-foreground text-sm" />
                </td>
                <td className="px-sm py-xs text-right">
                  <Currency value={item.unitPrice.mul(item.quantity)} className="text-sm" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function DataTableExpandableRowsShowcase(): React.ReactElement {
  return (
    <div className="gap-3xs flex flex-col">
      <DataTable
        columns={COLUMNS}
        data={ORDERS}
        getRowId={(row) => row.id}
        getRowCanExpand={(row) => row.original.lineItems.length > 1}
        renderSubComponent={(row) => <LineItemsPanel row={row} />}
      />
      <span className="text-2xs text-muted-foreground">
        `getRowCanExpand` her satır için chevron&apos;u koşullandırır — tek kalemli sipariş açılmaz,
        chevron yerine boş aynı-genişlik tutucu render edilir (satırlar dikey hizada kalır).
        `renderSubComponent` açılan içeriği döner; muted bg ile ayrılır. Klavyeden chevron butonuna
        Tab ile gel, Enter ile aç. Toggle butonu `data-row-action` taşımıyor — onRowClick ile
        pair&apos;lendiğinde açma butonuna tıklamak satır handler&apos;ını da tetikleyebilir;
        gerekirse butona elle ekle.
      </span>
    </div>
  );
}
