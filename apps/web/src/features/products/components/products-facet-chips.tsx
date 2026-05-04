'use client';

import { Cancel01Icon, PlusSignIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

import {
  PRODUCT_VARIANT_STATUSES,
  type ProductVariantStatus,
} from '../lib/products-filter-parsers';

export interface FacetOption {
  value: string;
  label: string;
  count?: number;
}

interface ProductsFacetChipsProps {
  brand: string;
  category: string;
  status: ProductVariantStatus;
  brandOptions: FacetOption[];
  categoryOptions: FacetOption[];
  onBrandChange: (next: string) => void;
  onCategoryChange: (next: string) => void;
  onStatusChange: (next: ProductVariantStatus) => void;
}

/**
 * Additive filter chips for the products toolbar — replaces the dedicated
 * dropdowns in the legacy ProductsFilterBar. Renders three chips (brand,
 * category, status) as ghost `+ Filtre` triggers when inactive; once a
 * value is set, the chip fills in with the active value and shows a
 * dedicated clear button.
 *
 * Brand and category are searchable popovers (Command primitive) so the
 * 100-200 brand list stays usable. Status is a fixed-options popover —
 * 4 enum values, no search needed.
 *
 * @useWhen rendering the products page's toolbar facet chips
 */
export function ProductsFacetChips({
  brand,
  category,
  status,
  brandOptions,
  categoryOptions,
  onBrandChange,
  onCategoryChange,
  onStatusChange,
}: ProductsFacetChipsProps): React.ReactElement {
  const t = useTranslations('products.facets');
  const tStatus = useTranslations('products.filters.statusOptions');

  const brandActive = brandOptions.find((o) => o.value === brand);
  const categoryActive = categoryOptions.find((o) => o.value === category);
  const statusActive = status !== 'onSale'; // 'onSale' is the implicit default

  return (
    <div className="gap-xs flex flex-wrap items-center">
      <SearchableFacetChip
        active={brandActive !== undefined}
        triggerLabel={
          brandActive !== undefined
            ? t('brand.active', { name: brandActive.label })
            : t('brand.trigger')
        }
        clearLabel={t('brand.clear')}
        searchPlaceholder={t('brand.search')}
        noResultsLabel={t('brand.noResults')}
        options={brandOptions}
        currentValue={brand}
        onSelect={onBrandChange}
        onClear={() => onBrandChange('')}
      />
      <SearchableFacetChip
        active={categoryActive !== undefined}
        triggerLabel={
          categoryActive !== undefined
            ? t('category.active', { name: categoryActive.label })
            : t('category.trigger')
        }
        clearLabel={t('category.clear')}
        searchPlaceholder={t('category.search')}
        noResultsLabel={t('category.noResults')}
        options={categoryOptions}
        currentValue={category}
        onSelect={onCategoryChange}
        onClear={() => onCategoryChange('')}
      />
      <StatusChip
        active={statusActive}
        triggerLabel={
          statusActive ? t('status.active', { label: tStatus(status) }) : t('status.trigger')
        }
        clearLabel={t('status.clear')}
        currentValue={status}
        onSelect={onStatusChange}
        onClear={() => onStatusChange('onSale')}
      />
    </div>
  );
}

interface SearchableFacetChipProps {
  active: boolean;
  triggerLabel: string;
  clearLabel: string;
  searchPlaceholder: string;
  noResultsLabel: string;
  options: FacetOption[];
  currentValue: string;
  onSelect: (next: string) => void;
  onClear: () => void;
}

function SearchableFacetChip({
  active,
  triggerLabel,
  clearLabel,
  searchPlaceholder,
  noResultsLabel,
  options,
  currentValue,
  onSelect,
  onClear,
}: SearchableFacetChipProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="gap-3xs inline-flex items-center">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant={active ? 'secondary' : 'outline'}
            size="sm"
            className={cn('gap-2xs', !active && 'text-muted-foreground')}
          >
            {!active ? <PlusSignIcon className="size-icon-xs" aria-hidden /> : null}
            {triggerLabel}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <Command>
            <CommandInput placeholder={searchPlaceholder} />
            <CommandList>
              <CommandEmpty>{noResultsLabel}</CommandEmpty>
              <CommandGroup>
                {options.map((opt) => (
                  <CommandItem
                    key={opt.value}
                    value={opt.label}
                    onSelect={() => {
                      onSelect(opt.value);
                      setOpen(false);
                    }}
                    aria-selected={opt.value === currentValue}
                  >
                    <span className="flex-1">{opt.label}</span>
                    {opt.count !== undefined ? (
                      <span className="text-muted-foreground text-2xs tabular-nums">
                        {opt.count}
                      </span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {active ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={clearLabel}
          onClick={onClear}
          className="text-muted-foreground hover:text-foreground"
        >
          <Cancel01Icon className="size-icon-xs" aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}

interface StatusChipProps {
  active: boolean;
  triggerLabel: string;
  clearLabel: string;
  currentValue: ProductVariantStatus;
  onSelect: (next: ProductVariantStatus) => void;
  onClear: () => void;
}

function StatusChip({
  active,
  triggerLabel,
  clearLabel,
  currentValue,
  onSelect,
  onClear,
}: StatusChipProps): React.ReactElement {
  const tStatus = useTranslations('products.filters.statusOptions');
  const [open, setOpen] = React.useState(false);
  return (
    <div className="gap-3xs inline-flex items-center">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant={active ? 'secondary' : 'outline'}
            size="sm"
            className={cn('gap-2xs', !active && 'text-muted-foreground')}
          >
            {!active ? <PlusSignIcon className="size-icon-xs" aria-hidden /> : null}
            {triggerLabel}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-3xs w-48" align="start">
          {PRODUCT_VARIANT_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                onSelect(s);
                setOpen(false);
              }}
              className={cn(
                'gap-xs px-sm py-xs flex w-full items-center rounded-sm text-left text-sm',
                'hover:bg-muted',
                s === currentValue && 'font-medium',
              )}
            >
              {tStatus(s)}
            </button>
          ))}
        </PopoverContent>
      </Popover>
      {active ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={clearLabel}
          onClick={onClear}
          className="text-muted-foreground hover:text-foreground"
        >
          <Cancel01Icon className="size-icon-xs" aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}
