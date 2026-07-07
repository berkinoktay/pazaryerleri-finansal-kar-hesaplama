'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { type ToneKey } from '@/lib/variants';

/**
 * Upload/export status pill for a saved Flash Products upload. Like the Advantage list
 * there is no validity axis on the LIST — the per-offer window validity lives on the detail
 * rows — so the only status dimension is exported vs pending. Exported reads as a quiet
 * success pill; not-yet-exported reads as a neutral "Bekliyor".
 */
type FlashStatusKey = 'exported' | 'pending';

const STATUS_TONE: Record<FlashStatusKey, ToneKey> = {
  exported: 'success',
  pending: 'neutral',
};

export interface FlashProductStatusBadgeProps {
  exported: boolean;
}

export function FlashProductStatusBadge({
  exported,
}: FlashProductStatusBadgeProps): React.ReactElement {
  const t = useTranslations('flashProductsPage.status');
  const key: FlashStatusKey = exported ? 'exported' : 'pending';
  return (
    <Badge tone={STATUS_TONE[key]} variant="surface" size="sm" className="gap-2xs">
      <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden />
      {t(key)}
    </Badge>
  );
}
