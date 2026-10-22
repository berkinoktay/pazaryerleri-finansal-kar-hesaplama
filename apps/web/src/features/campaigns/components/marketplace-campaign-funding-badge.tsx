'use client';

import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';

import { hasTrendyolFunding } from '../lib/marketplace-campaign-list';

export interface MarketplaceCampaignFundingBadgeProps {
  /** Trendyol karşılama oranı (%), a "0"–"100" decimal string as the backend serializes it. */
  fundingPct: string;
}

/**
 * Trendyol's share of the campaign discount ("karşılama oranı") as a quiet info chip. Renders
 * nothing at 0 % — an unfunded campaign is the default (the seller bears the whole discount), so a
 * "%0" chip on most rows would be noise. The `amount` preset prints the rate without trailing
 * zeros in the viewer's locale ("60", "12,5"); it is display formatting only, never arithmetic.
 */
export function MarketplaceCampaignFundingBadge({
  fundingPct,
}: MarketplaceCampaignFundingBadgeProps): React.ReactElement | null {
  const t = useTranslations('marketplaceCampaignsPage.funding');
  const format = useFormatter();
  if (!hasTrendyolFunding(fundingPct)) return null;

  const percent = format.number(Number(fundingPct), 'amount');
  return (
    <Badge tone="info" variant="surface" size="sm" title={t('label', { percent })}>
      {t('badge', { percent })}
    </Badge>
  );
}
