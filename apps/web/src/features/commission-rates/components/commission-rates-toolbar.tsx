'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { SearchInput } from '@/components/patterns/search-input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

interface CommissionRatesToolbarProps {
  q: string;
  onSearchChange: (next: string) => void;
  productScope: 'all' | 'active';
  onProductScopeChange: (next: 'all' | 'active') => void;
}

/**
 * Search + scope toggle row, mounted in DataTable's `toolbar` slot.
 * Two controls only (Q1 design — no facet filters in v1):
 *   1. SearchInput on `q` — matches categoryName / parentCategoryName
 *      / brandName backend-side. Debounce lives in the page client.
 *   2. "Sadece sattıklarım" checkbox — flips productScope between
 *      'all' and 'active' (Q2 design).
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
      <div className="gap-2xs flex items-center">
        <Checkbox
          id="commission-rates-active-only"
          checked={productScope === 'active'}
          onCheckedChange={(checked) => onProductScopeChange(checked === true ? 'active' : 'all')}
        />
        <Label htmlFor="commission-rates-active-only" className="cursor-pointer text-sm">
          {t('activeOnly')}
        </Label>
      </div>
    </div>
  );
}
