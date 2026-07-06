'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { InfoHint } from '@/components/patterns/info-hint';
import { TrendDelta } from '@/components/patterns/trend-delta';

import type { LivePerformanceKpis } from '../api/get-live-kpis.api';
import { computeDeltaPercent } from '../lib/compute-delta-percent';

/**
 * Caption under the live-performance hero (today's net profit). Composes existing
 * i18n keys (no dedicated caption string): the today-vs-yesterday delta chip
 * (omitted when yesterday was zero and the relative change is undefined),
 * yesterday's figure for context, an estimate ⓘ, and — only when orders still
 * await cost — the pending-gap sub-label that explains why profit trails revenue.
 *
 * Extracted from the page client so the header composition stays thin and this
 * self-contained piece is unit-testable on its own (feature-private).
 */
export function LiveHeroCaption({ kpis }: { kpis: LivePerformanceKpis }): React.ReactElement {
  const t = useTranslations('livePerformance');
  const netProfitDelta = computeDeltaPercent(kpis.netProfitToday, kpis.netProfitYesterday);

  return (
    <span className="gap-3xs flex flex-col">
      <span className="gap-xs inline-flex flex-wrap items-center">
        {netProfitDelta !== null ? <TrendDelta value={netProfitDelta} goodDirection="up" /> : null}
        <span>
          {t('chart.yesterdayLabel')} <Currency value={kpis.netProfitYesterday} />
        </span>
        <InfoHint label={t('kpis.netProfit')}>{t('kpis.estimateHint')}</InfoHint>
      </span>
      {kpis.pendingOrderCountToday > 0 ? (
        <span className="text-2xs text-muted-foreground">
          {t('kpis.pendingHint', { count: kpis.pendingOrderCountToday })}
        </span>
      ) : null}
    </span>
  );
}
