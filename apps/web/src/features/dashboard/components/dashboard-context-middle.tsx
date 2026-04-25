'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { RailWarningCard } from '@/components/patterns/rail-warning-card';
import { PeriodPresetList } from '@/features/dashboard/components/period-preset-list';
import {
  StoreSummaryCard,
  type StoreSummary,
} from '@/features/dashboard/components/store-summary-card';

// MOCK until backend endpoint lands — see Task 16 for the real hook.
const MOCK_SUMMARY: StoreSummary = {
  commissionPercent: 14.5,
  activeProducts: 12,
  apiHealth: 'healthy',
  lastSyncedLabel: '3 dk',
};

const MOCK_MISSING_COST_COUNT = 12;

/**
 * Composite for the ContextRail middle slot on the Dashboard route.
 * Lazy-loaded by ContextRail so non-dashboard routes don't pay the
 * weight. Hosts:
 *   - StoreSummaryCard (commission, active SKUs, API health, last sync)
 *   - PeriodPresetList (URL-bound period filter)
 *   - RailWarningCard (conditional, when there's an actionable issue)
 */
export default function DashboardContextMiddle(): React.ReactElement {
  const t = useTranslations('dashboardRail');
  return (
    <>
      <StoreSummaryCard data={MOCK_SUMMARY} />
      <PeriodPresetList />
      {MOCK_MISSING_COST_COUNT > 0 ? (
        <RailWarningCard
          title={t('warning.missingCost.title')}
          description={t('warning.missingCost.description', { count: MOCK_MISSING_COST_COUNT })}
          ctaLabel={t('warning.missingCost.cta')}
          ctaHref="/products?filter=no-cost"
        />
      ) : null}
    </>
  );
}
