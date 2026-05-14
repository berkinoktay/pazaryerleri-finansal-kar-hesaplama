'use client';

import { PlusSignIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { cn } from '@/lib/utils';

import type { VariantSummary } from '../api/list-products.api';

export interface DesiCellProps {
  variant: VariantSummary;
  /** Called when the cell is clicked — opens the desi popover. */
  onClick?: () => void;
}

/**
 * Desi (dimensional weight) cell for a product variant row in the products table.
 *
 * Three visual states:
 *   - Effective desi is null (both override and synced are absent)  →
 *       muted "+ Desi ekle" pill, mirroring the cost cell's empty affordance.
 *   - Effective desi is present, no user override                  →
 *       plain number with `tabular-nums`.
 *   - Effective desi is present, user override                     →
 *       number tinted in `text-primary` with a small trailing dot — the
 *       override is the load-bearing UX signal, so it gets a semantic color,
 *       not an alpha shortcut.
 *
 * The 32px height (`h-7`) matches the cost cell to keep dense-table rhythm.
 */
export function DesiCell({ variant, onClick }: DesiCellProps): React.ReactElement {
  const t = useTranslations('products.desiCell');

  if (variant.dimensionalWeight === null) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="text-muted-foreground/70 hover:text-primary hover:bg-primary/5 duration-fast gap-2xs inline-flex h-7 cursor-pointer items-center rounded-sm px-2 text-xs transition-colors"
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
      {variant.dimensionalWeight}
      {overridden ? (
        <span aria-hidden className="text-primary text-2xs">
          ●
        </span>
      ) : null}
    </button>
  );
}
