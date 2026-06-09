'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { FilterTabs } from '@/components/patterns/filter-tabs';
import { SearchInput } from '@/components/patterns/search-input';

import type { CommissionRateProductScope } from '../query-keys';

interface CommissionRatesToolbarProps {
  q: string;
  onSearchChange: (next: string) => void;
  productScope: CommissionRateProductScope;
  onProductScopeChange: (next: CommissionRateProductScope) => void;
}

/**
 * Search + product-scope row, mounted in DataTable's `toolbar` slot.
 * Two controls only (Q1 design — no facet filters in v1):
 *   1. SearchInput on `q` — matches categoryName / parentCategoryName /
 *      brandName backend-side. Debounce lives in the page client.
 *   2. Product-scope segment ("Tümü" / "Sattıklarım") — a `FilterTabs`
 *      pill that flips productScope between 'all' and 'active' (Q2 design).
 *      Reads as a proper segmented control rather than the bare checkbox
 *      it replaced, and stays consistent with the rule-kind strip above.
 */
export function CommissionRatesToolbar({
  q,
  onSearchChange,
  productScope,
  onProductScopeChange,
}: CommissionRatesToolbarProps): React.ReactElement {
  const t = useTranslations('features.commissionRates.toolbar');

  return (
    <div className="gap-md flex flex-col items-stretch sm:flex-row sm:items-center sm:justify-between">
      <div className="max-w-input flex-1">
        <SearchInput
          value={q}
          onChange={(event) => onSearchChange(event.target.value)}
          onClear={() => onSearchChange('')}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchPlaceholder')}
        />
      </div>
      <FilterTabs<CommissionRateProductScope>
        value={productScope}
        onValueChange={onProductScopeChange}
        aria-label={t('scopeLabel')}
        options={[
          { value: 'all', label: t('scopeAll') },
          { value: 'active', label: t('scopeActive') },
        ]}
      />
    </div>
  );
}
