'use client';

import {
  type ColumnDef,
  type Row,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getPaginationRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { ArrowDown01Icon, ArrowRight01Icon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { EmptyState } from '@/components/patterns/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

import type { ProductWithVariants } from '../api/list-products.api';
import {
  dominantDeliveryDuration,
  getRepresentativeVariant,
  isMultiVariant,
  priceRange,
  summarizeStatus,
  totalStock,
  uniqueSizes,
} from '../lib/format-product';

import { ColorAttribute } from './color-attribute';
import { DeliveryBadge } from './delivery-badge';
import { ProductImageCell } from './product-image-cell';
import { ProductVariantTable } from './product-variant-table';
import { VariantStatusBadge } from './variant-status-badge';

interface ProductsTableProps {
  data: ProductWithVariants[];
  loading?: boolean;
  empty?: React.ReactNode;
}

/**
 * Single-variant products render flat — cells populated from the lone
 * variant, no chevron. Multi-variant products render with aggregate
 * cells (price range, summed stock, dominant status, dominant delivery)
 * and an expand chevron that reveals the full variant breakdown via
 * ProductVariantTable.
 *
 * Built directly on TanStack Table's expanded-row machinery rather than
 * going through the shared DataTable wrapper because the products table
 * has feature-specific composition needs (toolbar lives outside the
 * card, custom column rendering, sub-row that itself contains a Table).
 * The shared DataTable now exposes expand props, but this implementation
 * pre-dates that work and matches Trendyol's own panel layout exactly.
 */
export function ProductsTable({
  data,
  loading = false,
  empty,
}: ProductsTableProps): React.ReactElement {
  const t = useTranslations('products');
  const tCols = useTranslations('products.columns');
  const formatter = useFormatter();

  const columns = React.useMemo<ColumnDef<ProductWithVariants>[]>(
    () => [
      {
        id: 'expand',
        header: () => null,
        cell: ({ row }) =>
          row.getCanExpand() ? (
            <button
              type="button"
              onClick={row.getToggleExpandedHandler()}
              aria-label={row.getIsExpanded() ? t('a11y.collapseRow') : t('a11y.expandRow')}
              className={cn(
                'gap-3xs duration-fast inline-flex size-6 items-center justify-center rounded-sm transition-colors',
                'hover:bg-background',
              )}
            >
              {row.getIsExpanded() ? (
                <ArrowDown01Icon className="size-icon-xs" />
              ) : (
                <ArrowRight01Icon className="size-icon-xs" />
              )}
            </button>
          ) : null,
        size: 40,
      },
      {
        id: 'product',
        header: () => tCols('title'),
        cell: ({ row }) => {
          const product = row.original;
          const firstImage = product.images[0];
          return (
            <div className="gap-sm flex items-center">
              <ProductImageCell url={firstImage?.url ?? null} alt={product.title} />
              <div className="gap-3xs flex flex-col">
                <span className="text-foreground line-clamp-1 font-medium">{product.title}</span>
                <span className="text-muted-foreground font-mono text-xs">
                  {product.productMainId}
                </span>
              </div>
            </div>
          );
        },
      },
      {
        id: 'brand',
        header: () => tCols('brand'),
        cell: ({ row }) => row.original.brand.name ?? '—',
      },
      {
        id: 'category',
        header: () => tCols('category'),
        cell: ({ row }) => row.original.category.name ?? '—',
      },
      {
        id: 'color',
        header: () => tCols('color'),
        cell: ({ row }) => <ColorAttribute color={row.original.color} />,
      },
      {
        id: 'size',
        header: () => tCols('size'),
        cell: ({ row }) => {
          if (!isMultiVariant(row.original)) {
            const variant = getRepresentativeVariant(row.original);
            return variant?.size ?? '—';
          }
          const { shown, remaining } = uniqueSizes(row.original.variants);
          if (shown.length === 0) return '—';
          return (
            <span className="text-foreground text-sm">
              {shown.join(', ')}
              {remaining > 0 ? ` +${remaining.toString()}` : ''}
            </span>
          );
        },
      },
      {
        id: 'stockCode',
        header: () => tCols('stockCode'),
        cell: ({ row }) => {
          if (isMultiVariant(row.original)) {
            return (
              <span className="text-muted-foreground text-xs">
                {t('multiVariantPlaceholder', { n: row.original.variantCount })}
              </span>
            );
          }
          const variant = getRepresentativeVariant(row.original);
          return <span className="font-mono text-xs">{variant?.stockCode ?? '—'}</span>;
        },
      },
      {
        id: 'barcode',
        header: () => tCols('barcode'),
        cell: ({ row }) => {
          if (isMultiVariant(row.original)) {
            return (
              <span className="text-muted-foreground text-xs">
                {t('multiVariantPlaceholder', { n: row.original.variantCount })}
              </span>
            );
          }
          const variant = getRepresentativeVariant(row.original);
          return <span className="font-mono text-xs">{variant?.barcode ?? '—'}</span>;
        },
      },
      {
        id: 'salePrice',
        header: () => tCols('salePrice'),
        meta: { numeric: true },
        cell: ({ row }) => {
          const range = priceRange(row.original.variants);
          if (range === null) return '—';
          if (range.isSingle) {
            return formatter.number(Number.parseFloat(range.min), 'currency');
          }
          return (
            <span className="tabular-nums">
              {formatter.number(Number.parseFloat(range.min), 'currency')}
              {' – '}
              {formatter.number(Number.parseFloat(range.max), 'currency')}
            </span>
          );
        },
      },
      {
        id: 'stock',
        header: () => tCols('stock'),
        meta: { numeric: true },
        cell: ({ row }) => {
          const total = totalStock(row.original.variants);
          return <span className="tabular-nums">{total}</span>;
        },
      },
      {
        id: 'delivery',
        header: () => tCols('delivery'),
        cell: ({ row }) => {
          const { value, mixed } = dominantDeliveryDuration(row.original.variants);
          const variant = getRepresentativeVariant(row.original);
          return (
            <DeliveryBadge
              durationDays={value}
              isRush={variant?.isRushDelivery ?? false}
              mixed={mixed}
            />
          );
        },
      },
      {
        id: 'status',
        header: () => tCols('status'),
        cell: ({ row }) => {
          const summary = summarizeStatus(row.original.variants);
          if (summary === null) return '—';
          const others = Object.entries(summary.counts)
            .filter(([key]) => key !== summary.dominant)
            .reduce((sum, [, n]) => sum + (n ?? 0), 0);
          return <VariantStatusBadge status={summary.dominant} overflowCount={others} />;
        },
      },
    ],
    [t, tCols, formatter],
  );

  const table = useReactTable({
    data,
    columns,
    getRowId: (row) => row.id,
    getRowCanExpand: (row) => isMultiVariant(row.original),
    state: {},
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  return (
    <div className="border-border bg-card overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <TableRow key={`skeleton-${i.toString()}`}>
                {columns.map((_col, colIdx) => (
                  <TableCell key={colIdx}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : table.getRowModel().rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="p-0">
                {empty ?? <EmptyState title={t('empty.filtered')} className="border-0" />}
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => <ProductRow key={row.id} row={row} />)
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function ProductRow({ row }: { row: Row<ProductWithVariants> }): React.ReactElement {
  return (
    <>
      <TableRow data-state={row.getIsExpanded() ? 'expanded' : undefined}>
        {row.getVisibleCells().map((cell) => {
          const isNumeric = cell.column.columnDef.meta?.numeric === true;
          return (
            <TableCell
              key={cell.id}
              data-numeric={isNumeric || undefined}
              className={cn(isNumeric && 'text-right')}
            >
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </TableCell>
          );
        })}
      </TableRow>
      {row.getIsExpanded() ? (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={row.getVisibleCells().length} className="bg-muted p-0">
            <ProductVariantTable variants={row.original.variants} />
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}
