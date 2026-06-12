'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';

/**
 * Variant'a bağlanmamış satırın "needs attention" sinyali. Kalıcı bir durum
 * değil: variant-resolution tick'i / eager onarım bağladığında rozet
 * kendiliğinden düşer — bu yüzden ton 'warning', 'destructive' değil.
 * patterns'a terfi (spec 2026-06-12 PR-4): ikinci tüketici LP today-products
 * + buffer Sheet satırları (WET+1).
 */
export function UnmatchedVariantBadge({ className }: { className?: string }): React.ReactElement {
  const t = useTranslations('common');
  return (
    <Badge tone="warning" size="sm" className={className}>
      {t('unmatchedBadge')}
    </Badge>
  );
}
