'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { type ToneKey } from '@/lib/variants';

/**
 * Upload/export status pill for a saved Advantage tariff. Unlike the commission /
 * Plus lists there is no validity axis — an Advantage file carries no dates — so
 * the only status dimension is exported vs pending. Exported reads as a quiet
 * success pill; not-yet-exported reads as a neutral "Bekliyor". (The same export
 * signal is also shown as an inline indicator in its own column; this pill gives
 * the status column a home so the table mirrors the Plus/commission list shape.)
 */
type AdvantageStatusKey = 'exported' | 'pending';

const STATUS_TONE: Record<AdvantageStatusKey, ToneKey> = {
  exported: 'success',
  pending: 'neutral',
};

export interface AdvantageTariffStatusBadgeProps {
  exported: boolean;
}

export function AdvantageTariffStatusBadge({
  exported,
}: AdvantageTariffStatusBadgeProps): React.ReactElement {
  const t = useTranslations('productLabelsPage.status');
  const key: AdvantageStatusKey = exported ? 'exported' : 'pending';
  return (
    <Badge tone={STATUS_TONE[key]} variant="surface" size="sm" className="gap-2xs">
      <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden />
      {t(key)}
    </Badge>
  );
}
