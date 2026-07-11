'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';

/**
 * Compact status chip for a variant the marketplace catalog delta has
 * reported as delisted (removed from the active catalog). Rendered only on
 * delisted variant rows in the products table — the absence of the chip is
 * the "still listed" state, so there is no positive counterpart to render.
 *
 * Tone is `destructive` on the soft `surface` treatment (not solid): a
 * delisted variant is the catalog-level equivalent of a lost listing, so it
 * reuses the same destructive token this table already applies to an
 * out-of-stock (0) count — no new color, just the existing attention role.
 */
export function VariantDelistedBadge(): React.ReactElement {
  const t = useTranslations('products.table');
  return (
    <Badge tone="destructive" size="sm">
      {t('variantDelisted')}
    </Badge>
  );
}
