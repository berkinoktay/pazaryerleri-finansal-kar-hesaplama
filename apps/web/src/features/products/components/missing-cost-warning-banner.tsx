'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useMissingCostStats } from '@/features/costs/hooks/use-missing-cost-stats';

export interface MissingCostWarningBannerProps {
  /** Organization id for the missing-cost stats query. Null disables the query. */
  orgId: string | null;
  /**
   * Active store id. The products page is store-scoped, so the banner counts
   * ONLY this store's missing-cost variants — its CTA also filters just this
   * store's table, so the count and the filtered result must agree.
   */
  storeId: string;
  /** Called when the seller clicks the CTA to filter products without costs. */
  onFilterClick: () => void;
}

/**
 * Inline warning banner shown above the products table when one or more of the
 * ACTIVE STORE's product variants have no attached active cost profiles. Hidden
 * entirely when the store's count === 0 — never taunts the seller with an empty
 * state widget.
 *
 * @useWhen products page top-of-content area, above the products table
 */
export function MissingCostWarningBanner({
  orgId,
  storeId,
  onFilterClick,
}: MissingCostWarningBannerProps): React.ReactElement | null {
  const t = useTranslations('products.missingCostBanner');
  const { data } = useMissingCostStats(orgId, storeId);

  if (data === undefined || data.count === 0) {
    return null;
  }

  return (
    <Alert tone="warning">
      <div className="gap-sm flex flex-wrap items-center justify-between">
        <div>
          <AlertTitle>{t('title', { count: data.count })}</AlertTitle>
          <AlertDescription>{t('description')}</AlertDescription>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={onFilterClick}>
          {t('cta')}
        </Button>
      </div>
    </Alert>
  );
}
