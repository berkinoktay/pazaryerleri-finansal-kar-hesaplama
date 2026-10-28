'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

export interface MissingShippingCounts {
  total: number;
  noDesi: number;
  noCarrier: number;
  overflow: number;
}

export interface MissingShippingBannerProps {
  counts: MissingShippingCounts;
}

const SHIPPING_SETTINGS_HREF = '/settings/stores/shipping';

/**
 * Banner above the products table for variants whose shipping estimate, and so
 * the estimated profit, could not be produced. Two cases:
 *
 *   - Store setup: a NO_CARRIER / OWN_CONTRACT_EMPTY variant means the store
 *     has no default carrier, or its own contract tariff is empty. That is one
 *     store setting, so every variant of the store is affected and a per-page
 *     count would understate it; the banner names the setting and links to it.
 *   - Per variant: missing desi or a desi above the carrier's range. These
 *     counts cover the loaded page only (the API has no store-wide shipping
 *     status count yet), and the title says so.
 *
 * Hidden when the page has nothing to report, so it never taunts the seller
 * with an empty-state widget.
 *
 * @useWhen products page top-of-content area, between the page header and the products table
 */
export function MissingShippingBanner({
  counts,
}: MissingShippingBannerProps): React.ReactElement | null {
  const t = useTranslations('shipping.products.banner');

  if (counts.noCarrier > 0) {
    return (
      <Alert tone="warning">
        <div className="gap-sm flex flex-wrap items-center justify-between">
          <div>
            <AlertTitle>{t('storeSetup.title')}</AlertTitle>
            <AlertDescription>{t('storeSetup.description')}</AlertDescription>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href={SHIPPING_SETTINGS_HREF}>{t('storeSetup.cta')}</Link>
          </Button>
        </div>
      </Alert>
    );
  }

  const variantCount = counts.noDesi + counts.overflow;
  if (variantCount === 0) {
    return null;
  }

  // Only the reasons that actually occur: a "desi eksik (0)" entry is noise
  // and reads as a problem where there is none.
  const reasons = [
    { key: 'reasonNoDesi', count: counts.noDesi },
    { key: 'reasonOverflow', count: counts.overflow },
  ] as const;
  const breakdown = reasons
    .filter((reason) => reason.count > 0)
    .map((reason) => t(reason.key, { count: reason.count }))
    .join(' · ');

  return (
    <Alert tone="warning">
      <AlertTitle>{t('title', { count: variantCount })}</AlertTitle>
      <AlertDescription>{breakdown}</AlertDescription>
    </Alert>
  );
}
