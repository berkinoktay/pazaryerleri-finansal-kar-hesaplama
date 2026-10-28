'use client';

import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useMissingCostStats } from '@/features/costs/hooks/use-missing-cost-stats';

export interface MissingCostWarningBannerProps {
  /** Organization id for the missing-cost stats query. Null disables the query. */
  orgId: string | null;
  /**
   * Active store id. The products page is store-scoped, so the banner counts
   * ONLY this store's missing-cost products and variants; its CTA opens the
   * missing-cost tab of this store's table, so the counts and the tab agree.
   */
  storeId: string;
  /** Called when the seller clicks the CTA to open the missing-cost tab. */
  onFilterClick: () => void;
}

/**
 * Inline warning banner shown above the products table when one or more of the
 * ACTIVE STORE's listed variants (not delisted, not archived) have no attached
 * active cost profile. The title names both units: products (what the
 * missing-cost tab lists) and variants (what the seller has to fill in).
 * Hidden entirely when the store has no missing-cost variant, so it never
 * taunts the seller with an empty-state widget.
 *
 * @useWhen products page top-of-content area, above the products table
 */
export function MissingCostWarningBanner({
  orgId,
  storeId,
  onFilterClick,
}: MissingCostWarningBannerProps): React.ReactElement | null {
  const t = useTranslations('products.missingCostBanner');
  const formatter = useFormatter();
  const { data } = useMissingCostStats(orgId, storeId);

  if (data === undefined || data.count === 0) {
    return null;
  }

  return (
    <Alert tone="warning">
      <div className="gap-sm flex flex-wrap items-center justify-between">
        <div>
          <AlertTitle>
            {t('title', {
              products: formatter.number(data.missingProductCount, 'integer'),
              variants: formatter.number(data.count, 'integer'),
            })}
          </AlertTitle>
          <AlertDescription>{t('description')}</AlertDescription>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={onFilterClick}>
          {t('cta')}
        </Button>
      </div>
    </Alert>
  );
}
