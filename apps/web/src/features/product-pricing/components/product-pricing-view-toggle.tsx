'use client';

import { GridViewIcon, LeftToRightListBulletIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

import {
  PRODUCT_PRICING_VIEWS,
  type ProductPricingView,
} from '../hooks/use-product-pricing-filters';

const VIEW_ICON: Record<ProductPricingView, React.ReactNode> = {
  table: <LeftToRightListBulletIcon aria-hidden className="size-icon-xs" />,
  cards: <GridViewIcon aria-hidden className="size-icon-xs" />,
};

interface ProductPricingViewToggleProps {
  view: ProductPricingView;
  onViewChange: (next: ProductPricingView) => void;
}

/**
 * Liste / Kart segmented control for the list page. A `single` ToggleGroup —
 * Radix returns an empty string when the active item is re-clicked, which we
 * ignore so the user can never end up with no view selected. Each option pairs
 * an icon with its label so the control reads at a glance on every viewport.
 */
export function ProductPricingViewToggle({
  view,
  onViewChange,
}: ProductPricingViewToggleProps): React.ReactElement {
  const t = useTranslations('features.productPricing.view');

  const labelMap: Record<ProductPricingView, string> = {
    table: t('list'),
    cards: t('cards'),
  };

  return (
    <ToggleGroup
      type="single"
      value={view}
      onValueChange={(next) => {
        if (next === 'table' || next === 'cards') onViewChange(next);
      }}
      aria-label={t('label')}
    >
      {PRODUCT_PRICING_VIEWS.map((option) => (
        <ToggleGroupItem key={option} value={option} aria-label={labelMap[option]}>
          {VIEW_ICON[option]}
          {labelMap[option]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
