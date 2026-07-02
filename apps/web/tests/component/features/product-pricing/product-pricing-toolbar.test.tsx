import { type ColumnDef, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  ProductPricingToolbar,
  type ProductPricingToolbarProps,
} from '@/features/product-pricing/components/product-pricing-toolbar';
import type { PricingAdvancedParams } from '@/features/product-pricing/lib/pricing-filter-fields';

import { render, screen } from '../../../helpers/render';

interface Row {
  id: string;
}
const COLUMNS: ColumnDef<Row>[] = [{ id: 'id', header: 'Id', cell: ({ row }) => row.original.id }];
const DATA: Row[] = [{ id: '1' }];

const EMPTY_PARAMS: PricingAdvancedParams = {
  categoryId: '',
  brandId: '',
  marginMin: '',
  marginMax: '',
  lossOnly: false,
};

const FACETS = {
  categories: [{ id: 'c1', name: 'Tişört', count: 4 }],
  brands: [{ id: 'b1', name: 'Koton', count: 9 }],
  overrideCounts: { missingCost: 0, missingVat: 0, total: 0 },
};

type HarnessProps = Partial<
  Pick<
    ProductPricingToolbarProps<Row>,
    'q' | 'onSearchChange' | 'params' | 'onParamsApply' | 'hasActiveFilters' | 'onClearFilters'
  >
>;

function Harness(props: HarnessProps): React.ReactElement {
  const table = useReactTable({ data: DATA, columns: COLUMNS, getCoreRowModel: getCoreRowModel() });
  return (
    <ProductPricingToolbar
      table={table}
      q={props.q ?? ''}
      onSearchChange={props.onSearchChange ?? (() => {})}
      params={props.params ?? EMPTY_PARAMS}
      onParamsApply={props.onParamsApply ?? (() => {})}
      hasActiveFilters={props.hasActiveFilters ?? false}
      onClearFilters={props.onClearFilters ?? (() => {})}
      facets={FACETS}
    />
  );
}

describe('ProductPricingToolbar — advancedFilter config', () => {
  it('emits search changes through the controlled toolbar search', async () => {
    const onSearchChange = vi.fn();
    const { user } = render(<Harness onSearchChange={onSearchChange} />);
    await user.type(screen.getByPlaceholderText(/ara/i), 'a');
    expect(onSearchChange).toHaveBeenCalledWith('a');
  });

  it('commits the loss-only flag in one tap with the full params set', async () => {
    const onParamsApply = vi.fn();
    const { user } = render(<Harness onParamsApply={onParamsApply} />);
    await user.click(screen.getByRole('button', { name: /Filtre ekle/ }));
    await user.click(await screen.findByText('Sadece zarar edenleri göster'));
    expect(onParamsApply).toHaveBeenCalledWith({ ...EMPTY_PARAMS, lossOnly: true });
  });

  it('commits a category chip through the single-select editor', async () => {
    const onParamsApply = vi.fn();
    const { user } = render(<Harness onParamsApply={onParamsApply} />);
    await user.click(screen.getByRole('button', { name: /Filtre ekle/ }));
    await user.click(await screen.findByText('Kategori'));
    await user.click(await screen.findByText('Tişört'));
    await user.click(screen.getByRole('button', { name: 'Uygula' }));
    expect(onParamsApply).toHaveBeenCalledWith({ ...EMPTY_PARAMS, categoryId: 'c1' });
  });

  it('commits a margin range chip whose bounds land on marginMin/marginMax', async () => {
    const onParamsApply = vi.fn();
    const { user } = render(<Harness onParamsApply={onParamsApply} />);
    await user.click(screen.getByRole('button', { name: /Filtre ekle/ }));
    await user.click(await screen.findByText(/[Mm]arj/));
    await user.type(screen.getByRole('textbox', { name: 'En az' }), '10');
    await user.type(screen.getByRole('textbox', { name: 'En çok' }), '40');
    await user.click(screen.getByRole('button', { name: 'Uygula' }));
    expect(onParamsApply).toHaveBeenCalledWith({
      ...EMPTY_PARAMS,
      marginMin: '10',
      marginMax: '40',
    });
  });

  it('derives chips from committed params and removing one clears its dimension', async () => {
    const onParamsApply = vi.fn();
    const { user } = render(
      <Harness params={{ ...EMPTY_PARAMS, brandId: 'b1' }} onParamsApply={onParamsApply} />,
    );
    const group = screen.getByRole('group', { name: 'Uygulanan filtreler' });
    expect(group).toHaveTextContent('Koton');
    await user.click(screen.getByRole('button', { name: 'Filtreyi kaldır' }));
    expect(onParamsApply).toHaveBeenCalledWith(EMPTY_PARAMS);
  });

  it('shows the server-mode clear ghost and fires onClearFilters', async () => {
    const onClearFilters = vi.fn();
    const { user } = render(<Harness hasActiveFilters onClearFilters={onClearFilters} />);
    await user.click(screen.getByRole('button', { name: /Temizle/ }));
    expect(onClearFilters).toHaveBeenCalledOnce();
  });
});
