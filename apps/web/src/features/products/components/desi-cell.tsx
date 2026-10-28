'use client';

import { PlusSignIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { formatTrDecimal } from '@/lib/parse-tr-decimal';
import { cn } from '@/lib/utils';

import type { VariantSummary } from '../api/list-products.api';

export interface DesiCellProps {
  variant: VariantSummary;
  /** Called when the cell is clicked: opens the desi popover. */
  onClick?: () => void;
}

/**
 * Desi (dimensional weight) cell for a product variant row in the products table.
 *
 * Three visual states:
 *   - Missing desi (the backend's `isDimensionalWeightMissing`: no override
 *     and Trendyol sent no desi, so the wire value is a placeholder "0"):
 *       the "Desi gir" call to action, mirroring the cost cell's empty
 *       affordance. The rule lives in the backend only; this cell reads the
 *       flag and never re-derives it from the values.
 *   - A desi, no user override: the number in Turkish format ("1,5") with
 *       `tabular-nums`.
 *   - A desi, user override: the number tinted in `text-primary` with a
 *       small trailing dot. The override is the load-bearing UX signal, so
 *       it gets a semantic color, not an alpha shortcut. An override of 0 is
 *       a real value and renders "0" here, not the call to action.
 *
 * The 32px height (`h-7`) matches the cost cell to keep dense-table rhythm.
 */
export function DesiCell({ variant, onClick }: DesiCellProps): React.ReactElement {
  const t = useTranslations('products.desiCell');

  // A null effective desi never reaches the wire (the synced column is NOT
  // NULL); with no value to show, the call to action is the honest rendering.
  if (variant.isDimensionalWeightMissing || variant.dimensionalWeight === null) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="text-muted-foreground hover:text-primary hover:bg-primary/5 duration-fast gap-2xs inline-flex h-7 cursor-pointer items-center rounded-sm px-2 text-xs transition-colors"
      >
        <PlusSignIcon className="size-icon-xs" />
        {t('addDesi')}
      </button>
    );
  }

  const overridden = variant.isDimensionalWeightOverridden;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={overridden ? t('overrideAria') : undefined}
      className={cn(
        'gap-2xs hover:bg-muted/60 duration-fast inline-flex h-7 cursor-pointer items-center rounded-sm px-2 text-sm tabular-nums transition-colors',
        overridden ? 'text-primary font-medium' : 'text-foreground',
      )}
    >
      {formatTrDecimal(variant.dimensionalWeight)}
      {overridden ? (
        <span aria-hidden className="text-primary text-2xs">
          ●
        </span>
      ) : null}
    </button>
  );
}
