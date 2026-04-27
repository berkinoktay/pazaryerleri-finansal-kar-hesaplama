'use client';

import { Cancel01Icon, Search01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import type { ProductFacetsResponse } from '../api/list-product-facets.api';
import {
  PRODUCT_VARIANT_STATUSES,
  type ProductVariantStatus,
} from '../lib/products-filter-parsers';

import { FacetSelect, type FacetOption } from './facet-select';

interface ProductsFilterBarProps {
  q: string;
  status: ProductVariantStatus;
  brandId: string;
  categoryId: string;
  onSearchChange: (next: string) => void;
  onStatusChange: (next: ProductVariantStatus) => void;
  onBrandChange: (next: string) => void;
  onCategoryChange: (next: string) => void;
  onClearAll: () => void;
  facets: ProductFacetsResponse | undefined;
  /** Right-aligned actions slot — the page passes the SyncCenter chip here in PR 5. */
  actionsSlot?: React.ReactNode;
}

const SEARCH_DEBOUNCE_MS = 300;

export function ProductsFilterBar(props: ProductsFilterBarProps): React.ReactElement {
  const t = useTranslations('products.filters');
  const tStatus = useTranslations('products.filters.statusOptions');
  const [localSearch, setLocalSearch] = React.useState(props.q);

  // Resync local input from props.q during render when the URL changes
  // externally (e.g. browser back/forward). This is the React docs
  // pattern for "reset state when a prop changes" — preferred over
  // useEffect + setState because it runs in the same render pass and
  // the linter recognizes it as the canonical idiom.
  // https://react.dev/learn/you-might-not-need-an-effect#resetting-all-state-when-a-prop-changes
  const [prevPropQ, setPrevPropQ] = React.useState(props.q);
  if (props.q !== prevPropQ) {
    setPrevPropQ(props.q);
    setLocalSearch(props.q);
  }

  // Debounced commit of the search input back to the URL state.
  const onSearchChange = props.onSearchChange;
  React.useEffect(() => {
    if (localSearch === props.q) return;
    const handle = setTimeout(() => onSearchChange(localSearch), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [localSearch, props.q, onSearchChange]);

  const statusOptions = React.useMemo<FacetOption[]>(
    () =>
      PRODUCT_VARIANT_STATUSES.map((status) => ({
        value: status,
        label: tStatus(status),
      })),
    [tStatus],
  );

  const brandOptions = React.useMemo<FacetOption[]>(
    () =>
      (props.facets?.brands ?? []).map((b) => ({
        value: b.id,
        label: b.name,
        count: b.count,
      })),
    [props.facets?.brands],
  );

  const categoryOptions = React.useMemo<FacetOption[]>(
    () =>
      (props.facets?.categories ?? []).map((c) => ({
        value: c.id,
        label: c.name,
        count: c.count,
      })),
    [props.facets?.categories],
  );

  const hasActiveFilter =
    props.q.length > 0 ||
    props.status !== 'onSale' ||
    props.brandId.length > 0 ||
    props.categoryId.length > 0;

  return (
    <div className="gap-md flex flex-wrap items-center">
      <div className="max-w-input relative flex-1">
        <Search01Icon
          className="size-icon-sm text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2"
          aria-hidden
        />
        <Input
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="pl-10"
          aria-label={t('searchPlaceholder')}
        />
      </div>

      <FacetSelect
        label={t('status')}
        value={props.status}
        options={statusOptions}
        onChange={(next) =>
          props.onStatusChange((next === '' ? 'onSale' : next) as ProductVariantStatus)
        }
        emptyLabel={tStatus('onSale')}
        searchable={false}
      />

      <FacetSelect
        label={t('brand')}
        value={props.brandId}
        options={brandOptions}
        onChange={props.onBrandChange}
        emptyLabel={t('allBrands')}
      />

      <FacetSelect
        label={t('category')}
        value={props.categoryId}
        options={categoryOptions}
        onChange={props.onCategoryChange}
        emptyLabel={t('allCategories')}
      />

      {hasActiveFilter ? (
        <Button variant="ghost" size="sm" onClick={props.onClearAll} className={cn('gap-xs')}>
          <Cancel01Icon className="size-icon-xs" />
          {t('clear')}
        </Button>
      ) : null}

      {props.actionsSlot !== undefined ? <div className="ml-auto">{props.actionsSlot}</div> : null}
    </div>
  );
}
