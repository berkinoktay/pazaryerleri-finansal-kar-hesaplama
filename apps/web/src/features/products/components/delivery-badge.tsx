'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';

interface DeliveryBadgeProps {
  /** Trendyol's deliveryDuration in days. null → standard (no rush). */
  durationDays: number | null;
  /** True if Trendyol flagged this variant as rush-eligible. */
  isRush?: boolean;
  /** Mixed across variants — render the "Karışık" label instead of a value. */
  mixed?: boolean;
}

/**
 * Maps Trendyol's `deliveryDuration` (days) to a localized badge.
 *   1   → Bugün kargoda
 *   2   → Yarın kargoda
 *   3+  → "{n} gün"
 *   null → Standart
 *   mixed → Karışık
 */
export function DeliveryBadge({
  durationDays,
  isRush = false,
  mixed = false,
}: DeliveryBadgeProps): React.ReactElement {
  const t = useTranslations('products.delivery');

  if (mixed) {
    return <Badge tone="outline">{t('mixed')}</Badge>;
  }
  if (durationDays === null) {
    return <Badge tone="outline">{t('standard')}</Badge>;
  }
  if (durationDays === 1) {
    return <Badge tone={isRush ? 'success' : 'info'}>{t('sameDay')}</Badge>;
  }
  if (durationDays === 2) {
    return <Badge tone="info">{t('nextDay')}</Badge>;
  }
  return <Badge tone="outline">{t('days', { n: durationDays })}</Badge>;
}
