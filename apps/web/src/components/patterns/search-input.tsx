'use client';

import { Search01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Input, type InputProps } from '@/components/ui/input';

/**
 * Convention wrapper around Input for search fields. Bakes in the
 * leading magnifier icon, the onClear button (with i18n'd aria-label
 * via `t('common.clear')`), and a sensible localized placeholder
 * (`t('common.search')`) so every search field across the product
 * looks and behaves identically without consumers re-wiring the same
 * three details.
 *
 * Three existing call sites manually composed this trio
 * (products-filter-bar, data-table-toolbar, etc.) before this
 * primitive existed — promotion follows the WET+1 rule.
 *
 * For typeahead-filtered command palettes use Command from ui/; for
 * generic single-line text input use Input directly.
 *
 * @useWhen rendering a search field with leading icon + onClear + standard placeholder (use Command for typeahead command palettes)
 */

export interface SearchInputProps extends Omit<
  InputProps,
  'leading' | 'leadingIcon' | 'type' | 'inputMode'
> {
  /** Override the localized default ("Ara…" / "Search…") if a screen needs custom copy. */
  placeholder?: string;
}

export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  function SearchInput({ placeholder, onClear, clearLabel, ...inputProps }, ref) {
    const t = useTranslations('common');
    return (
      <Input
        ref={ref}
        type="search"
        inputMode="search"
        leadingIcon={<Search01Icon />}
        onClear={onClear}
        clearLabel={clearLabel ?? t('clear')}
        placeholder={placeholder ?? t('search')}
        {...inputProps}
      />
    );
  },
);
