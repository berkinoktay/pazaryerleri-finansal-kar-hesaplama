'use client';

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
 * Three states:
 *   - 0 profiles → "+ Maliyet ekle" placeholder button
 *   - 1 profile  → currency amount + badge showing "1 profil"
 *   - N profiles → currency amount + badge showing "N profil"
 *
 * Hover tooltip lists profile names when `profileNames` is supplied.
 * The cell itself is the click target that opens the `CostCellPopover`.
 */
export function CostCell({ variant, profileNames, onClick }: CostCellProps): React.ReactElement {
  const t = useTranslations('products.costCell');

  if (variant.profileCount === 0) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="text-muted-foreground hover:text-primary duration-fast text-xs transition-colors"
      >
        {t('addCost')}
      </button>
    );
  }

  const cell = (
    <button
      type="button"
      onClick={onClick}
      className="gap-xs hover:bg-muted duration-fast inline-flex cursor-pointer items-center rounded px-1 py-0.5 transition-colors"
    >
      <Currency value={variant.currentCostTry ?? '0'} />
      <Badge tone="neutral" size="sm" radius="full">
        {t('profileCount', { count: variant.profileCount })}
      </Badge>
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
