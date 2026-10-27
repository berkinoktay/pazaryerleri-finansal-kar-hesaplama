'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { type ToneKey } from '@/lib/variants';

import type { MarketplaceCampaignListStatus } from '../lib/marketplace-campaign-list';

/**
 * Upload/export status pill for a saved Kampanyalar upload — the list's only status axis (the
 * campaign window has its own column instead of being folded into a validity state). Exported
 * reads as a quiet success pill; not-yet-exported reads as a neutral "Bekliyor".
 */
const STATUS_TONE: Record<MarketplaceCampaignListStatus, ToneKey> = {
  exported: 'success',
  pending: 'neutral',
};

export interface MarketplaceCampaignStatusBadgeProps {
  status: MarketplaceCampaignListStatus;
}

export function MarketplaceCampaignStatusBadge({
  status,
}: MarketplaceCampaignStatusBadgeProps): React.ReactElement {
  const t = useTranslations('marketplaceCampaignsPage.status');
  return (
    <Badge tone={STATUS_TONE[status]} variant="surface" size="sm" className="gap-2xs">
      <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden />
      {t(status)}
    </Badge>
  );
}
