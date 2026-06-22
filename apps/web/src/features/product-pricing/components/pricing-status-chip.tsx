'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { MappedBadge } from '@/components/patterns/mapped-badge';
import { type BadgeProps } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import type { ProductPricingItem } from '../api/list-product-pricing.api';
import { resolvePricingStatus, type PricingStatusKind } from '../lib/pricing-status';

/** Every flagged status reads the `warning` tone — these are gaps, not failures. */
const STATUS_TONE: Record<PricingStatusKind, BadgeProps['tone']> = {
  cost: 'warning',
  shipping: 'warning',
  commission: 'warning',
};

/**
 * Quiet-when-healthy status chip shared by the table cell and the gallery
 * card. A calculable row renders NOTHING (the profit numbers are the
 * signal). A non-calculable row surfaces a single warning-tone chip naming
 * the first missing input, with a tooltip carrying the precise sub-status
 * reason.
 */
export function PricingStatusChip({
  item,
}: {
  item: ProductPricingItem;
}): React.ReactElement | null {
  const t = useTranslations('features.productPricing.status');
  // Group-scoped translators keep the sub-status enum value a statically
  // typed message key (no dynamic dotted lookup): the API enum members line
  // up 1:1 with the keys under each detail group.
  const tCost = useTranslations('features.productPricing.status.detail.cost');
  const tShipping = useTranslations('features.productPricing.status.detail.shipping');
  const tCommission = useTranslations('features.productPricing.status.detail.commission');
  const descriptor = resolvePricingStatus(item);

  if (descriptor === null) {
    return null;
  }

  const labelMap: Record<PricingStatusKind, React.ReactNode> = {
    cost: t('costMissing'),
    shipping: t('shippingMissing'),
    commission: t('commissionMissing'),
  };

  const detail =
    descriptor.group === 'cost'
      ? tCost(descriptor.detail)
      : descriptor.group === 'shipping'
        ? tShipping(descriptor.detail)
        : tCommission(descriptor.detail);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Span (not button): this chip may sit inside a clickable row;
            role/tabIndex keep it focusable so the tooltip opens on keyboard
            focus without nesting a button. */}
        <span
          className="inline-flex cursor-help"
          data-row-action
          tabIndex={0}
          role="button"
          aria-label={t('ariaLabel')}
        >
          <MappedBadge<PricingStatusKind>
            value={descriptor.kind}
            toneMap={STATUS_TONE}
            labelMap={labelMap}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent align="start" className="max-w-input-narrow">
        {detail}
      </TooltipContent>
    </Tooltip>
  );
}
