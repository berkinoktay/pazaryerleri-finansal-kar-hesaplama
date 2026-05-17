'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export interface MissingShippingCounts {
  total: number;
  noDesi: number;
  noCarrier: number;
  overflow: number;
}

export interface MissingShippingBannerProps {
  counts: MissingShippingCounts;
  onFilterApply: () => void;
}

/**
 * Aggregate banner above the products table summarizing variants whose
 * shipping estimate could not be produced. Hidden when `total === 0`
 * — never taunts the seller with an empty state widget.
 *
 * Composition mirrors the existing `MissingCostWarningBanner`: a
 * `tone="warning"` Alert with a leading icon, title + breakdown
 * description, and a single outline CTA that hands control back to
 * the page's filter state. The banner is presentational only — it
 * does not mutate filters itself.
 *
 * @useWhen products page top-of-content area, between the page header and the products table
 */
export function MissingShippingBanner({
  counts,
  onFilterApply,
}: MissingShippingBannerProps): React.ReactElement | null {
  const t = useTranslations('shipping.products.banner');

  if (counts.total === 0) {
    return null;
  }

  return (
    <Alert tone="warning">
      <div className="gap-sm flex flex-wrap items-center justify-between">
        <div>
          <AlertTitle>{t('title', { count: counts.total })}</AlertTitle>
          <AlertDescription>
            {t('breakdown', {
              noDesi: counts.noDesi,
              noCarrier: counts.noCarrier,
              overflow: counts.overflow,
            })}
          </AlertDescription>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={onFilterApply}>
          {t('filterCta')}
        </Button>
      </div>
    </Alert>
  );
}
