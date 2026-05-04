'use client';

import { type ColumnDef } from '@tanstack/react-table';
import { ArrowDown01Icon, ArrowRight01Icon } from 'hugeicons-react';
import * as React from 'react';

import { DataTable } from '@/components/patterns/data-table';
import { Badge } from '@/components/ui/badge';

interface SkuRow {
  id: string;
  kind: 'parent' | 'variant';
  label: string;
  sku?: string;
  stock: number;
  status: 'live' | 'paused';
  children?: SkuRow[];
}

const DATA: SkuRow[] = [
  {
    id: 'p1',
    kind: 'parent',
    label: 'Keten gömlek',
    stock: 42,
    status: 'live',
    children: [
      {
        id: 'p1.s',
        kind: 'variant',
        label: 'S · Beyaz',
        sku: 'KGM-S-BYZ',
        stock: 14,
        status: 'live',
      },
      {
        id: 'p1.m',
        kind: 'variant',
        label: 'M · Beyaz',
        sku: 'KGM-M-BYZ',
        stock: 21,
        status: 'live',
      },
      {
        id: 'p1.l',
        kind: 'variant',
        label: 'L · Beyaz',
        sku: 'KGM-L-BYZ',
        stock: 7,
        status: 'paused',
      },
    ],
  },
  {
    id: 'p2',
    kind: 'parent',
    label: 'Tek varyantlı kalem',
    sku: 'KAL-001',
    stock: 99,
    status: 'live',
  },
];

const COLUMNS: ColumnDef<SkuRow>[] = [
  {
    id: 'expand',
    enableSorting: false,
    cell: ({ row }) => {
      if (row.depth > 0) {
        return (
          <span aria-hidden className="text-muted-foreground">
            └
          </span>
        );
      }
      if (!row.getCanExpand()) {
        return <span aria-hidden className="size-icon-sm inline-block" />;
      }
      const expanded = row.getIsExpanded();
      return (
        <button
          type="button"
          onClick={row.getToggleExpandedHandler()}
          aria-label={expanded ? 'Kapat' : 'Aç'}
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
    id: 'label',
    header: 'Ürün',
    cell: ({ row }) => (
      <span className={row.depth > 0 ? 'text-muted-foreground' : 'text-foreground font-medium'}>
        {row.original.label}
      </span>
    ),
  },
  {
    id: 'sku',
    header: 'SKU',
    cell: ({ row }) =>
      row.original.sku !== undefined ? (
        <span className="font-mono text-xs">{row.original.sku}</span>
      ) : (
        <span className="text-muted-foreground text-xs">
          {row.original.children?.length ?? 0} varyant
        </span>
      ),
  },
  {
    id: 'stock',
    header: 'Stok',
    meta: { numeric: true },
    cell: ({ row }) => <span className="tabular-nums">{row.original.stock}</span>,
  },
  {
    id: 'status',
    header: 'Durum',
    cell: ({ row }) => (
      <Badge tone={row.original.status === 'live' ? 'success' : 'warning'}>
        {row.original.status === 'live' ? 'Yayında' : 'Pasif'}
      </Badge>
    ),
  },
];

export function DataTableSubrowsShowcase(): React.ReactElement {
  return (
    <div className="gap-3xs flex flex-col">
      <DataTable
        columns={COLUMNS}
        data={DATA}
        getRowId={(row) => row.id}
        getRowCanExpand={(row) => (row.original.children?.length ?? 0) > 0}
        getSubRows={(row) => row.children}
      />
      <span className="text-2xs text-muted-foreground">
        `getSubRows` her satır için varyant listesini döner — TanStack alt satırları aynı
        grid&apos;te sibling olarak render eder, parent&apos;ın column tanımlarını birebir uygular.
        Sub-row&apos;lar `data-depth=&quot;1&quot;` taşır; feature CSS&apos;i
        `tokens/components.css` üzerinden tek kaynaktan stilliyor (muted bg + leading cell indent).
        Tek varyantlı parent için chevron render edilmez ama aynı genişlikte boş tutucu gelir,
        sütunlar dikey hizada kalır.
      </span>
    </div>
  );
}
