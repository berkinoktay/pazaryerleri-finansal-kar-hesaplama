'use client';

import { type ColumnDef } from '@tanstack/react-table';
import * as React from 'react';

import { AdvancedFilterMenu } from '@/components/patterns/advanced-filter-menu';
import { Currency } from '@/components/patterns/currency';
import { DataTable } from '@/components/patterns/data-table';
import { DataTablePagination } from '@/components/patterns/data-table-pagination';
import { DataTableToolbar } from '@/components/patterns/data-table-toolbar';
import { Badge } from '@/components/ui/badge';
import {
  DATATYPE_OPERATORS,
  rangeBounds,
  type FilterFieldDef,
  type FilterRow,
} from '@/lib/advanced-filter';

// ─── Mock catalog + products (deterministic — no Math.random for SSR safety) ──

const BRANDS = [
  { id: '2032', name: 'Modline' },
  { id: '1001', name: 'Koton' },
  { id: '3050', name: 'LC Waikiki' },
  { id: '4012', name: 'Defacto' },
];

const CATEGORIES = [
  { id: '411', name: 'Tişört' },
  { id: '2122', name: 'Pantolon' },
  { id: '500', name: 'Elbise' },
];

const VAT_RATES = [0, 1, 10, 20];

interface MockProduct {
  id: string;
  title: string;
  salePrice: number;
  stock: number;
  vatRate: number;
  brandId: string;
  brandName: string;
  categoryId: string;
  categoryName: string;
}

const MOCK_PRODUCTS: MockProduct[] = Array.from({ length: 28 }, (_, i) => {
  const brand = BRANDS[i % BRANDS.length];
  const category = CATEGORIES[i % CATEGORIES.length];
  return {
    id: `p-${i.toString()}`,
    title: `${brand.name} ${category.name} ${(i + 1).toString()}`,
    salePrice: 30 + ((i * 67) % 770), // 30 … 799, varied
    stock: (i * 53) % 300, // 0 … 299, varied
    vatRate: VAT_RATES[i % VAT_RATES.length],
    brandId: brand.id,
    brandName: brand.name,
    categoryId: category.id,
    categoryName: category.name,
  };
});

const SHOWCASE_FIELDS: FilterFieldDef[] = [
  {
    key: 'salePrice',
    label: 'Satış fiyatı',
    groupLabel: 'Aralık',
    dataType: 'money',
    operators: [...DATATYPE_OPERATORS.money],
    unit: '₺',
  },
  {
    key: 'stock',
    label: 'Stok',
    groupLabel: 'Aralık',
    dataType: 'number',
    operators: [...DATATYPE_OPERATORS.number],
  },
  {
    key: 'vatRate',
    label: 'KDV oranı',
    groupLabel: 'Özellik',
    dataType: 'enumFixed',
    operators: [...DATATYPE_OPERATORS.enumFixed],
    enumValues: VAT_RATES.map((rate) => ({ value: rate.toString(), label: `%${rate.toString()}` })),
  },
  {
    key: 'brand',
    label: 'Marka',
    groupLabel: 'Özellik',
    dataType: 'enumMulti',
    operators: [...DATATYPE_OPERATORS.enumMulti],
    enumValues: BRANDS.map((brand) => ({ value: brand.id, label: brand.name })),
  },
  {
    key: 'category',
    label: 'Kategori',
    groupLabel: 'Özellik',
    dataType: 'enumMulti',
    operators: [...DATATYPE_OPERATORS.enumMulti],
    enumValues: CATEGORIES.map((category) => ({ value: category.id, label: category.name })),
  },
];

// ─── Client-side matcher (mirrors what the backend does server-side) ──────────

function inRange(value: number, [min, max]: [string | undefined, string | undefined]): boolean {
  if (min !== undefined && value < Number(min)) return false;
  if (max !== undefined && value > Number(max)) return false;
  return true;
}

function asSet(value: FilterRow['value']): Set<string> {
  return new Set(Array.isArray(value) ? value : value.length > 0 ? [value] : []);
}

function matchesFilters(product: MockProduct, rows: FilterRow[]): boolean {
  return rows.every((row) => {
    switch (row.field) {
      case 'salePrice':
        return inRange(product.salePrice, rangeBounds(row));
      case 'stock':
        return inRange(product.stock, rangeBounds(row));
      case 'vatRate': {
        const selected = asSet(row.value);
        return selected.size === 0 || selected.has(product.vatRate.toString());
      }
      case 'brand': {
        const selected = asSet(row.value);
        return selected.size === 0 || selected.has(product.brandId);
      }
      case 'category': {
        const selected = asSet(row.value);
        return selected.size === 0 || selected.has(product.categoryId);
      }
      default:
        return true;
    }
  });
}

// ─── Columns ──────────────────────────────────────────────────────────────────

const columns: ColumnDef<MockProduct>[] = [
  { accessorKey: 'title', header: 'Ürün' },
  {
    accessorKey: 'salePrice',
    header: 'Satış fiyatı',
    meta: { numeric: true },
    cell: ({ row }) => <Currency value={row.original.salePrice} />,
  },
  {
    accessorKey: 'stock',
    header: 'Stok',
    meta: { numeric: true },
    cell: ({ row }) => <span className="tabular-nums">{row.original.stock}</span>,
  },
  {
    accessorKey: 'vatRate',
    header: 'KDV',
    meta: { numeric: true },
    cell: ({ row }) => <span className="tabular-nums">%{row.original.vatRate}</span>,
  },
  {
    accessorKey: 'brandName',
    header: 'Marka',
    cell: ({ row }) => <Badge variant="outline">{row.original.brandName}</Badge>,
  },
  { accessorKey: 'categoryName', header: 'Kategori' },
];

export function AdvancedFilterShowcase(): React.ReactElement {
  const [filters, setFilters] = React.useState<FilterRow[]>([]);

  const data = React.useMemo(
    () => MOCK_PRODUCTS.filter((product) => matchesFilters(product, filters)),
    [filters],
  );

  return (
    <DataTable
      columns={columns}
      data={data}
      getRowId={(row) => row.id}
      empty={
        <p className="text-muted-foreground py-lg text-center text-sm">
          Bu filtrelere uyan ürün yok.
        </p>
      }
      toolbar={(table) => (
        <DataTableToolbar
          table={table}
          searchColumn="title"
          searchPlaceholder="Ürün ara..."
          facets={
            <AdvancedFilterMenu fields={SHOWCASE_FIELDS} value={filters} onApply={setFilters} />
          }
        />
      )}
      pagination={(table) => <DataTablePagination table={table} />}
    />
  );
}
