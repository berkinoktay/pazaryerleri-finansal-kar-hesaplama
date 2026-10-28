'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

import type { ProductWithVariants } from '../api/list-products.api';
import { useBulkUpdateVariantDimensionalWeight } from '../hooks/use-bulk-update-variant-dimensional-weight';
import { desiRange } from '../lib/format-product';

import { BulkDesiForm } from './bulk-desi-form';
import { DesiAddButton } from './desi-cell';

export interface ParentRowDesiCellProps {
  orgId: string;
  storeId: string;
  product: ProductWithVariants;
  /** Extra classes for the call to action (the table's numeric-cell alignment). */
  ctaClassName?: string;
}

/**
 * Desi column of a multi-variant product's collapsed row, like
 * ParentRowCostCell for cost:
 *   - Some variant has a known desi: the range of the known values ("1,5 – 3",
 *     or one value when they match). Variants that miss desi are left out of
 *     the range and show their own "Desi gir" once the row is expanded.
 *   - No variant has a known desi: "+ Desi gir", opening a popover that
 *     applies one value to every variant the row carries through the bulk
 *     desi endpoint. On the missing-desi tab the row carries only its missing
 *     variants, so only those are written.
 *
 * One component for both states, owning the popover and the mutation: the
 * optimistic update fills in the range the moment "apply" is pressed, so the
 * call to action and its popover stay while the popover is open or the save
 * is pending; the save's toast, inline error and close are not cut short.
 */
export function ParentRowDesiCell({
  orgId,
  storeId,
  product,
  ctaClassName,
}: ParentRowDesiCellProps): React.ReactElement {
  const t = useTranslations('products.parentDesi');
  const [open, setOpen] = React.useState(false);
  const mutation = useBulkUpdateVariantDimensionalWeight();
  const range = desiRange(product.variants);

  if (range !== null && !open && !mutation.isPending) {
    if (range.isSingle) {
      return (
        <span
          className={cn(
            'text-sm tabular-nums',
            range.anyOverridden ? 'text-primary font-medium' : 'text-foreground',
          )}
        >
          {range.min}
        </span>
      );
    }
    return (
      <span className="text-foreground text-sm tabular-nums">
        {range.min} – {range.max}
      </span>
    );
  }

  const variantIds = product.variants.map((v) => v.id);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <DesiAddButton className={ctaClassName} />
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="p-md gap-sm flex w-80 flex-col">
        <div className="gap-3xs flex flex-col">
          <p className="text-foreground text-sm font-semibold">{t('title')}</p>
          <p className="text-muted-foreground text-xs">
            {t('description', { count: variantIds.length })}
          </p>
        </div>
        <BulkDesiForm
          orgId={orgId}
          storeId={storeId}
          variantIds={variantIds}
          mutation={mutation}
          inputId={`parent-desi-${product.id}`}
          allowClearAll={false}
          showHelp={false}
          onDone={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
