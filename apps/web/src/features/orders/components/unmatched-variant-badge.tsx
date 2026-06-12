'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';

/**
 * Variant'a bağlanmamış kalemin "needs attention" sinyali. Kalıcı bir durum
 * değil: variant-resolution tick'i (PR-2) bağladığında rozet kendiliğinden
 * düşer — bu yüzden ton 'warning', 'destructive' değil.
 */
export function UnmatchedVariantBadge({ className }: { className?: string }): React.ReactElement {
  const t = useTranslations('orderDetail.items');
  return (
    <Badge tone="warning" size="sm" className={className}>
      {t('unmatchedBadge')}
    </Badge>
  );
}
