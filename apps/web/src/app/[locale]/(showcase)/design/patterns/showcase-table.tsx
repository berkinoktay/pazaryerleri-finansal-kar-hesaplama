'use client';

import { type ColumnDef } from '@tanstack/react-table';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { buildMockOrders, type MockOrder } from '@/components/showcase/showcase-mocks';

/**
 * Shared MockOrder table fixture for the DataTable showcase family.
 *
 * Every `data-table-*-showcase.tsx` used to copy-paste the same status maps and
 * the same 4–11 ColumnDef objects (select / orderNumber / customer / platform /
 * status / dates / money / actions). That duplication drifted (the page used 8
 * columns, pinning used 11, states used 5) and each edit had to be repeated in
 * up to five files. This module is the single source: pick the columns a demo
 * needs from `ORDER_COLUMNS`, or compose with `buildOrderColumns`.
 *
 * Status maps follow the semantic-tone contract (see `@/lib/variants`); the
 * money + identity cells are token-only. `buildShowcaseRows` re-exports the
 * deterministic, SSR-safe `buildMockOrders` generator so demos share one row
 * builder too.
 */

export type { MockOrder };

/** Maps the four mock order statuses to a semantic Badge tone. */
export const STATUS_TONE: Record<
  MockOrder['status'],
  'success' | 'info' | 'warning' | 'destructive'
> = {
  delivered: 'success',
  shipped: 'info',
  pending: 'warning',
  returned: 'destructive',
};

/** Turkish labels for the four mock order statuses. */
export const STATUS_LABEL: Record<MockOrder['status'], string> = {
  delivered: 'Teslim',
  shipped: 'Kargoda',
  pending: 'Bekleyen',
  returned: 'İade',
};

/** Deterministic, SSR-safe mock order generator shared by every demo. */
export function buildShowcaseRows(count: number): MockOrder[] {
  return buildMockOrders(count);
}

/** Stable key for every reusable column so callers compose by name. */
export type OrderColumnKey =
  | 'select'
  | 'orderNumber'
  | 'customer'
  | 'platform'
  | 'status'
  | 'orderDate'
  | 'grossAmount'
  | 'commissionAmount'
  | 'shippingCost'
  | 'netProfit';

/**
 * The canonical MockOrder column definitions, keyed by column id. Cells that
 * carry intrinsic width (`whitespace-nowrap` identity/date) keep that class so
 * a wide-column demo (pinning) can overflow its frame and exercise the
 * scroll-aware pin shadow; narrower demos simply omit those columns.
 */
export const ORDER_COLUMNS: Record<OrderColumnKey, ColumnDef<MockOrder>> = {
  select: {
    id: 'select',
    enableSorting: false,
    enableHiding: false,
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
  orderNumber: {
    accessorKey: 'orderNumber',
    header: 'Sipariş No',
    cell: ({ row }) => (
      <span className="text-foreground font-mono text-xs whitespace-nowrap">
        {row.original.orderNumber}
      </span>
    ),
  },
  customer: {
    accessorKey: 'customer',
    header: 'Müşteri',
    cell: ({ row }) => <span className="whitespace-nowrap">{row.original.customer}</span>,
  },
  platform: {
    accessorKey: 'platform',
    header: 'Pazaryeri',
    cell: ({ row }) => (
      <Badge variant="outline">
        {row.original.platform === 'TRENDYOL' ? 'Trendyol' : 'Hepsiburada'}
      </Badge>
    ),
  },
  status: {
    accessorKey: 'status',
    header: 'Durum',
    cell: ({ row }) => (
      <Badge tone={STATUS_TONE[row.original.status]}>{STATUS_LABEL[row.original.status]}</Badge>
    ),
  },
  orderDate: {
    accessorKey: 'orderDate',
    header: 'Tarih',
    cell: ({ row }) => (
      <span className="text-muted-foreground text-xs whitespace-nowrap">
        {row.original.orderDate.slice(0, 10)}
      </span>
    ),
  },
  grossAmount: {
    accessorKey: 'grossAmount',
    header: 'Ciro',
    meta: { numeric: true },
    cell: ({ row }) => <Currency value={row.original.grossAmount} />,
  },
  commissionAmount: {
    accessorKey: 'commissionAmount',
    header: 'Komisyon',
    meta: { numeric: true },
    cell: ({ row }) => (
      <Currency value={row.original.commissionAmount} className="text-muted-foreground" />
    ),
  },
  shippingCost: {
    accessorKey: 'shippingCost',
    header: 'Kargo',
    meta: { numeric: true },
    cell: ({ row }) => (
      <Currency value={row.original.shippingCost} className="text-muted-foreground" />
    ),
  },
  netProfit: {
    accessorKey: 'netProfit',
    header: 'Net kar',
    meta: { numeric: true },
    cell: ({ row }) => <Currency value={row.original.netProfit} emphasis />,
  },
};

/**
 * Composes a MockOrder column list by name. Pass the keys a demo needs (in
 * render order) plus any extra trailing columns (e.g. a row-actions kebab) that
 * aren't part of the shared set.
 */
export function buildOrderColumns(
  keys: readonly OrderColumnKey[],
  extras: readonly ColumnDef<MockOrder>[] = [],
): ColumnDef<MockOrder>[] {
  return [...keys.map((key) => ORDER_COLUMNS[key]), ...extras];
}
