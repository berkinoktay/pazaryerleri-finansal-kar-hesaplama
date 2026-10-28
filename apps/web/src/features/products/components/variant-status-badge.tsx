'use client';

import { InformationCircleIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { type ToneKey } from '@/lib/variants';

import type { VariantSummary } from '../api/list-products.api';
import {
  isKnownStatusReason,
  variantStatusBadgeKind,
  type VariantStatusBadgeKind,
} from '../lib/variant-status';

import { VariantDelistedBadge } from './variant-delisted-badge';

/**
 * Tone per chip. Destructive marks the states where the listing is lost
 * outright (no stock left, blacklisted by Trendyol); warning marks a lock the
 * seller can usually lift by fixing the price; neutral marks the calm states
 * (closed for sale, archived). "closed" also takes the outline treatment so it
 * stays the quietest chip in the stock column.
 */
const BADGE_STYLE: Record<VariantStatusBadgeKind, { tone: ToneKey; variant?: BadgeVariant }> = {
  outOfStock: { tone: 'destructive' },
  closed: { tone: 'neutral', variant: 'outline' },
  locked: { tone: 'warning' },
  blacklisted: { tone: 'destructive' },
  archived: { tone: 'neutral' },
};

export interface VariantStatusBadgeProps {
  variant: Pick<VariantSummary, 'status' | 'quantity' | 'statusReason' | 'delistedAt'>;
}

/**
 * Status chip under a variant's stock count in the products table: on the
 * variant sub-rows, and on the parent row of a single-variant product.
 *
 *   - Delisted (gone from Trendyol's catalog feed): the delisted chip. It wins
 *     over the status because the listing itself no longer exists.
 *   - On sale and listed: nothing.
 *   - A reason code we can explain (lock / blacklist): the chip becomes a
 *     button that opens a click Popover with the localized reason. A hover
 *     tooltip is unreachable on touch screens, so the reason is never
 *     hover-only. The trigger mirrors ProfitBadge: a button around the Badge,
 *     a trailing info icon, and a larger hit area under a coarse pointer.
 *   - Any other case: the plain chip.
 */
export function VariantStatusBadge({
  variant,
}: VariantStatusBadgeProps): React.ReactElement | null {
  const t = useTranslations('products.statusBadge');
  const tReason = useTranslations('products.statusReasons');

  if (variant.delistedAt !== null) return <VariantDelistedBadge />;

  const kind = variantStatusBadgeKind(variant);
  if (kind === null) return null;

  const label = t(kind);
  const style = BADGE_STYLE[kind];
  const reason = variant.statusReason;

  if (!isKnownStatusReason(reason)) {
    return (
      <Badge tone={style.tone} variant={style.variant} size="sm">
        {label}
      </Badge>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('reasonAria', { label })}
          className="group focus-visible:shadow-focus pointer-coarse:-m-xs pointer-coarse:p-xs cursor-pointer rounded-md focus-visible:outline-none"
        >
          <Badge
            tone={style.tone}
            variant={style.variant}
            size="sm"
            trailingIcon={
              <InformationCircleIcon
                aria-hidden
                className="duration-fast ease-out-quart opacity-60 transition-opacity group-hover:opacity-100"
              />
            }
            className="duration-fast ease-out-quart transition-shadow group-hover:shadow-xs"
          >
            {label}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end">
        <span className="text-foreground mb-2xs block text-xs font-semibold">
          {t('reasonTitle')}
        </span>
        <p className="text-muted-foreground text-xs">{tReason(reason)}</p>
      </PopoverContent>
    </Popover>
  );
}
