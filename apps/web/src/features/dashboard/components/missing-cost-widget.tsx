'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import * as React from 'react';

import { KpiTile } from '@/components/patterns/kpi-tile';
import { useMissingCostStats } from '@/features/costs/hooks/use-missing-cost-stats';

export interface MissingCostWidgetProps {
  /** Organization id for the missing-cost stats query. Null disables the query. */
  orgId: string | null;
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
 * `count === 0` — never taunts the seller with an empty state. Clicks navigate
 * to the products page filtered to the missing variants.
 *
 * @useWhen dashboard root or analytics overview, alongside other KpiTiles
 */
export function MissingCostWidget({
  orgId,
  filteredProductsHref,
}: MissingCostWidgetProps): React.ReactElement | null {
  const t = useTranslations('dashboard.missingCostWidget');
  const { data } = useMissingCostStats(orgId);

  if (data === undefined || data.count === 0) {
    return null;
  }

  const percentMissing =
    data.totalVariants > 0 ? Math.round((data.count / data.totalVariants) * 100) : 0;

  return (
    <Link href={filteredProductsHref} className="block">
      <KpiTile
        label={t('label', { count: data.count })}
        value={{ kind: 'count', amount: data.count }}
        context={t('percentOfTotal', { percent: percentMissing })}
      />
    </Link>
  );
}
