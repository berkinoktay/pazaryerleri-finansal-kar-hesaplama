'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';

import type { DeliveryInfo } from '../lib/format-product';

const EM_DASH = '\u2014';

interface DeliveryBadgeProps {
  /**
   * Delivery tier of one variant, or the shared tier of a parent row's
   * variants, from `computeDeliveryInfo` / `dominantDeliveryInfo` in
   * `lib/format-product.ts`. `null` (no variants) and the 'unknown' tier
   * render a muted em dash placeholder.
   */
  info: DeliveryInfo | null;
  /** The parent row's variants disagree: render the "mixed" chip instead of a tier. */
  mixed?: boolean;
}

/** Muted placeholder for "Trendyol reported no delivery promise". */
function NoDelivery(): React.ReactElement {
  return <span className="text-muted-foreground">{EM_DASH}</span>;
}

/**
 * Tone mapping is deliberate, not decorative:
 *
 *   today    -> success: shipping the same day is the strongest listing
 *               signal (Trendyol marks it for buyers with its own green chip).
 *   tomorrow -> info: a neutral context indicator, still a fast promise.
 *   later    -> neutral outline: the calmest tone, nothing to act on.
 */
export function DeliveryBadge({ info, mixed = false }: DeliveryBadgeProps): React.ReactElement {
  const t = useTranslations('products.delivery');
  if (mixed) {
    return <Badge variant="outline">{t('mixed')}</Badge>;
  }
  if (info === null) {
    return <NoDelivery />;
  }
  switch (info.tier) {
    case 'today':
      return <Badge tone="success">{t('today')}</Badge>;
    case 'tomorrow':
      return <Badge tone="info">{t('tomorrow')}</Badge>;
    case 'later':
      // computeDeliveryInfo always pairs 'later' with a day count; the null
      // check only narrows the type for the ICU argument.
      if (info.days === null) return <NoDelivery />;
      return (
        <Badge tone="neutral" variant="outline">
          {t('inDays', { days: info.days })}
        </Badge>
      );
    case 'unknown':
      return <NoDelivery />;
    default: {
      const _exhaustive: never = info.tier;
      throw new Error(`Unhandled delivery tier: ${String(_exhaustive)}`);
    }
  }
}
