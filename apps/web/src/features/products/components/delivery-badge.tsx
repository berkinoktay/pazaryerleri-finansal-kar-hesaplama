'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Badge, type BadgeProps } from '@/components/ui/badge';

import type { DeliveryType } from '../lib/format-product';

interface DeliveryBadgeProps {
  /**
   * Trendyol delivery tier — one of three values, see
   * `computeDeliveryType` in `lib/format-product.ts` for the mapping.
   * `null` ⇒ no variants / unknown — rendered as an em-dash placeholder.
   */
  type: DeliveryType | null;
  /** Mixed across variants on a parent row → "Karışık" instead of a tier. */
  mixed?: boolean;
}

/**
 * Tone mapping is deliberate, not decorative:
 *
 *   sameDay  → success — a same-day-shipping flag is a "good thing"
 *              for the seller's listing health (Trendyol surfaces it
 *              with a green chip in the buyer-facing UI too).
 *   fast     → info — neutral context indicator, the variant is on the
 *              fast-delivery program but not same-day.
 *   standard → outline — calmest tone, the default lead time, no signal
 *              the seller needs to act on.
 */
const BADGE: Record<DeliveryType, { tone: BadgeProps['tone']; variant?: BadgeProps['variant'] }> = {
  sameDay: { tone: 'success' },
  fast: { tone: 'info' },
  standard: { tone: 'neutral', variant: 'outline' },
};

export function DeliveryBadge({ type, mixed = false }: DeliveryBadgeProps): React.ReactElement {
  const t = useTranslations('products.delivery');
  if (mixed) {
    return <Badge variant="outline">{t('mixed')}</Badge>;
  }
  if (type === null) {
    return <span className="text-muted-foreground">—</span>;
  }
  // The DeliveryType union (`'sameDay' | 'fast' | 'standard'`) is the
  // same shape as the i18n keys under `products.delivery.*`, so we can
  // pass the type directly as the message key — no separate label map
  // needed (and next-intl's literal-keyed `t()` typecheck stays happy).
  return (
    <Badge tone={BADGE[type].tone} variant={BADGE[type].variant}>
      {t(type)}
    </Badge>
  );
}
