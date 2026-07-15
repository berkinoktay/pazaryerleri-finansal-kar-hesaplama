'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { type ToneKey } from '@/lib/variants';

/**
 * Upload/export status pill for a saved İndirimler upload. Like the Flash list there is no
 * validity axis on the LIST — the per-discount window lives on the config — so the only status
 * dimension is exported vs pending. Exported reads as a quiet success pill; not-yet-exported
 * reads as a neutral "Bekliyor".
 */
type DiscountStatusKey = 'exported' | 'pending';

const STATUS_TONE: Record<DiscountStatusKey, ToneKey> = {
  exported: 'success',
  pending: 'neutral',
};

export interface DiscountListStatusBadgeProps {
  exported: boolean;
}

export function DiscountListStatusBadge({
  exported,
}: DiscountListStatusBadgeProps): React.ReactElement {
  const t = useTranslations('discountsPage.status');
  const key: DiscountStatusKey = exported ? 'exported' : 'pending';
  return (
    <Badge tone={STATUS_TONE[key]} variant="surface" size="sm" className="gap-2xs">
      <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden />
      {t(key)}
    </Badge>
  );
}
