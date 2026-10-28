'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';

/**
 * Compact status chip for a variant that is gone from Trendyol's catalog
 * feed. The full catalog scan's absence pass stamps delistedAt when the
 * variant is missing from a complete sweep; the hourly delta clears it again
 * when the variant reappears. Rendered by VariantStatusBadge in the products
 * table stock cell (variant rows, and the parent row of a single-variant
 * product), where it takes precedence over the status chip. The absence of
 * the chip is the "still listed" state, so there is no positive counterpart
 * to render.
 *
 * Tone is `destructive` on the soft `surface` treatment (not solid): a
 * delisted variant is the catalog-level equivalent of a lost listing, so it
 * reuses the same destructive token this table already applies to an
 * out-of-stock (0) count. No new color, just the existing attention role.
 */
export function VariantDelistedBadge(): React.ReactElement {
  const t = useTranslations('products.table');
  return (
    <Badge tone="destructive" size="sm">
      {t('variantDelisted')}
    </Badge>
  );
}
