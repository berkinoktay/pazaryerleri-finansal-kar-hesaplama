'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { SearchInput } from '@/components/patterns/search-input';
import { RangeInput } from '@/components/ui/range-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import type { PricingFacetsResponse } from '../api/list-pricing-facets.api';

interface ProductPricingToolbarProps {
  q: string;
  onSearchChange: (next: string) => void;
  marginMin: string;
  marginMax: string;
  onMarginMinChange: (next: string) => void;
  onMarginMaxChange: (next: string) => void;
  categoryId: string;
  brandId: string;
  onCategoryChange: (next: string) => void;
  onBrandChange: (next: string) => void;
  facets: PricingFacetsResponse | undefined;
  facetsLoading: boolean;
}

// Radix Select forbids an empty-string item value, so the "all" sentinel
// carries a non-empty token. The page maps it back to '' (no filter).
const ALL_VALUE = '__all__';

/**
 * Filter row for the pricing list, mounted in DataTable's `toolbar` slot:
 *   1. SearchInput on `q` — matches barcode / SKU / product name
 *      backend-side. Debounce lives in the page client.
 *   2. Category + brand single-selects, populated from the store's product
 *      facets. The "Tümü" option clears the dimension.
 *   3. Margin range (min–max %) — the `between` editor on saleMarginPct.
 *
 * The profit-status segment lives in the table's `tabs` slot above this row.
 */
export function ProductPricingToolbar({
  q,
  onSearchChange,
  marginMin,
  marginMax,
  onMarginMinChange,
  onMarginMaxChange,
  categoryId,
  brandId,
  onCategoryChange,
  onBrandChange,
  facets,
  facetsLoading,
}: ProductPricingToolbarProps): React.ReactElement {
  const t = useTranslations('features.productPricing.toolbar');

  const categories = facets?.categories ?? [];
  const brands = facets?.brands ?? [];

  return (
    <div className="gap-md flex flex-col">
      <div className="gap-sm flex flex-col sm:flex-row sm:flex-wrap sm:items-center">
        <div className="max-w-input w-full sm:flex-1">
          <SearchInput
            value={q}
            onChange={(event) => onSearchChange(event.target.value)}
            onClear={() => onSearchChange('')}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
          />
        </div>

        <div className="gap-sm flex flex-col sm:flex-row sm:items-center">
          <Select
            value={categoryId.length > 0 ? categoryId : ALL_VALUE}
            onValueChange={(next) => onCategoryChange(next === ALL_VALUE ? '' : next)}
            disabled={facetsLoading}
          >
            <SelectTrigger
              size="sm"
              className="sm:max-w-input-narrow w-full"
              aria-label={t('categoryLabel')}
              onClear={categoryId.length > 0 ? () => onCategoryChange('') : undefined}
            >
              <SelectValue placeholder={t('categoryAll')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>{t('categoryAll')}</SelectItem>
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={brandId.length > 0 ? brandId : ALL_VALUE}
            onValueChange={(next) => onBrandChange(next === ALL_VALUE ? '' : next)}
            disabled={facetsLoading}
          >
            <SelectTrigger
              size="sm"
              className="sm:max-w-input-narrow w-full"
              aria-label={t('brandLabel')}
              onClear={brandId.length > 0 ? () => onBrandChange('') : undefined}
            >
              <SelectValue placeholder={t('brandAll')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>{t('brandAll')}</SelectItem>
              {brands.map((brand) => (
                <SelectItem key={brand.id} value={brand.id}>
                  {brand.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Margin range on its own line so the four-field toolbar never crowds on
          narrow widths. The label names the dimension the min–max bounds act on. */}
      <div className="gap-sm flex flex-col sm:flex-row sm:items-center">
        <span className="text-2xs text-muted-foreground shrink-0">{t('marginRangeLabel')}</span>
        <div className="sm:max-w-input w-full">
          <RangeInput
            min={marginMin}
            max={marginMax}
            onMinChange={onMarginMinChange}
            onMaxChange={onMarginMaxChange}
            unit="%"
            minLabel={t('marginMin')}
            maxLabel={t('marginMax')}
          />
        </div>
      </div>
    </div>
  );
}
