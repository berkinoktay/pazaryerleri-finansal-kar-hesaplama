'use client';

import { PlusSignIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import type { VariantSummary } from '../api/list-products.api';

export interface CostCellProps {
  variant: VariantSummary;
  /** Profile names for the hover tooltip. Passed in when the popover has already loaded the list. */
  profileNames?: string[];
  /** Called when the cell is clicked — opens the cost popover. */
  onClick?: () => void;
}

/**
 * Cost cell for a product variant row in the products table.
 *
 * Three visual states:
 *   - 0 profiles → muted "+ Maliyet ekle" pill (dashed-on-hover affordance)
 *   - 1 profile  → currency amount alone (no badge — count of 1 is the
 *                  common case and a "1 profil" pill would just be noise)
 *   - N profiles → currency amount + tight count chip ("2", "3", …)
 *
 * Hover tooltip lists profile names when `profileNames` is supplied.
 * Click target sized to satisfy the 32px minimum density rule for
 * dense tables — bigger than the prior `px-1 py-0.5` micro-button.
 */
export function CostCell({ variant, profileNames, onClick }: CostCellProps): React.ReactElement {
  const t = useTranslations('products.costCell');

  if (variant.profileCount === 0) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="text-muted-foreground/70 hover:text-primary hover:bg-primary/5 duration-fast gap-2xs inline-flex h-7 cursor-pointer items-center rounded-sm px-2 text-xs transition-colors"
      >
        <PlusSignIcon className="size-icon-xs" />
        {t('addCost')}
      </button>
    );
  }

  const showCountChip = variant.profileCount > 1;
  const cell = (
    <button
      type="button"
      onClick={onClick}
      className="gap-xs hover:bg-muted/60 duration-fast inline-flex h-7 cursor-pointer items-center rounded-sm px-2 transition-colors"
    >
      <Currency value={variant.currentCostTry ?? '0'} className="text-sm tabular-nums" />
      {showCountChip ? (
        <Badge
          tone="neutral"
          size="sm"
          radius="full"
          className="text-2xs px-1.5 font-medium tabular-nums"
        >
          {variant.profileCount}
        </Badge>
      ) : null}
    </button>
  );

  if (profileNames === undefined || profileNames.length === 0) {
    return cell;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{cell}</TooltipTrigger>
      <TooltipContent>
        <ul className="gap-3xs flex flex-col">
          {profileNames.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}
