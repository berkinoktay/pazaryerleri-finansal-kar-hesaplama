'use client';

import { type Table } from '@tanstack/react-table';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { DataTableToolbar } from '@/components/patterns/data-table-toolbar';

import type { PricingFacetsResponse } from '../api/list-pricing-facets.api';
import { usePricingFilterFields } from '../hooks/use-pricing-filter-fields';
import {
  pricingFilterParamsFromRows,
  pricingFilterRowsFromParams,
  type PricingAdvancedParams,
} from '../lib/pricing-filter-fields';

export interface ProductPricingToolbarProps<TData> {
  table: Table<TData>;
  q: string;
  onSearchChange: (next: string) => void;
  /** Committed (URL-owned) advanced dimensions — chips are derived from these. */
  params: PricingAdvancedParams;
  /** Commits the full advanced set — called on every chip add / edit / remove / clear. */
  onParamsApply: (next: PricingAdvancedParams) => void;
  /** True when ANY filter (search, sort override, chips) is active — drives the clear ghost. */
  hasActiveFilters: boolean;
  /** One-click reset of the whole filter set (search + chips + sort). */
  onClearFilters: () => void;
  facets: PricingFacetsResponse | undefined;
}

/**
 * Pricing toolbar as a thin composition over the shared DataTableToolbar:
 * controlled search (debounce lives in the page client) + the
 * `advancedFilter` config (category/brand single-select chips, sale-margin
 * percent range, loss-only flag). The old hand-rolled Select/RangeInput/
 * Switch row is gone — margin bounds now commit explicitly via the chip
 * editor's Uygula, so the page client no longer debounces them.
 */
export function ProductPricingToolbar<TData>({
  table,
  q,
  onSearchChange,
  params,
  onParamsApply,
  hasActiveFilters,
  onClearFilters,
  facets,
}: ProductPricingToolbarProps<TData>): React.ReactElement {
  const t = useTranslations('features.productPricing.toolbar');
  const filterFields = usePricingFilterFields(facets);
  const filterRows = pricingFilterRowsFromParams(params);

  return (
    <DataTableToolbar
      table={table}
      searchValue={q}
      onSearchChange={onSearchChange}
      searchPlaceholder={t('searchPlaceholder')}
      advancedFilter={{
        fields: filterFields,
        value: filterRows,
        onApply: (rows) => onParamsApply(pricingFilterParamsFromRows(rows)),
      }}
      hasActiveFilters={hasActiveFilters}
      onClearFilters={onClearFilters}
    />
  );
}
