'use client';

import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { StatCard } from '@/components/patterns/stat-card';
import { useMissingCostStats } from '@/features/costs/hooks/use-missing-cost-stats';

export interface MissingCostWidgetProps {
  /** Organization id for the missing-cost stats query. Null disables the query. */
  orgId: string | null;
  /**
   * Active store id. The dashboard follows the "default scope = selected store"
   * rule, so the widget counts ONLY this store's missing-cost variants — its
   * drill-down goes to that store's filtered products table, so the count must
   * match the destination.
   */
  storeId: string;
  /**
   * Locale-aware path to the products page filtered to missing-cost variants.
   * Caller assembles the URL (route + locale + ?costStatus=NO_PROFILES) so the
   * widget stays decoupled from the routing strategy.
   */
  filteredProductsHref: string;
}

/**
 * Compact KPI tile shown alongside other dashboard widgets when one or more
 * product variants are missing cost profiles. Hidden entirely when
 * `count === 0` — never taunts the seller with an empty state. The whole card
 * is the drill-down (StatCard `href` stretched-link) to the filtered products
 * page.
 *
 * @useWhen dashboard root or analytics overview, alongside other StatCards
 */
export function MissingCostWidget({
  orgId,
  storeId,
  filteredProductsHref,
}: MissingCostWidgetProps): React.ReactElement | null {
  const t = useTranslations('dashboard.missingCostWidget');
  const formatter = useFormatter();
  const { data } = useMissingCostStats(orgId, storeId);

  if (data === undefined || data.count === 0) {
    return null;
  }

  const percentMissing =
    data.totalVariants > 0 ? Math.round((data.count / data.totalVariants) * 100) : 0;

  return (
    <StatCard
      href={filteredProductsHref}
      label={t('label', { count: data.count })}
      value={formatter.number(data.count, 'integer')}
      context={t('percentOfTotal', { percent: percentMissing })}
    />
  );
}
