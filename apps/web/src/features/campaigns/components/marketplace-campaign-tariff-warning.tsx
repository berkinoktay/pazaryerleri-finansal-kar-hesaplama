'use client';

import { Alert02Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';

/**
 * The quiet warning a row carries when the file puts the product on a commission tariff but no
 * uploaded tariff week covers the campaign (design §4.3): its profit uses the product's own or the
 * category rate, so the real rate may differ. The badge text says what is missing; the hover title
 * spells out the consequence. Shared by the desktop product cell and the mobile card.
 */
export function MarketplaceCampaignTariffWarning(): React.ReactElement {
  const t = useTranslations('marketplaceCampaignsPage.table');
  return (
    <Badge
      tone="warning"
      variant="surface"
      size="sm"
      leadingIcon={<Alert02Icon aria-hidden />}
      title={t('tariffWarningHint')}
    >
      {t('tariffWarning')}
    </Badge>
  );
}
