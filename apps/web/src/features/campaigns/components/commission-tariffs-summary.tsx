'use client';

import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { StatCard } from '@/components/patterns/stat-card';
import { StatGroup } from '@/components/patterns/stat-group';
import { Button } from '@/components/ui/button';

import type { TariffSelectionSummary } from '../lib/commission-tariff-summary';

export interface CommissionTariffsSummaryProps {
  summary: TariffSelectionSummary;
  /** Applies each product's most profitable band in one click. */
  onApplyBest: () => void;
}

/**
 * Header KPI strip for the Product Commission Tariffs page. The headline is the
 * estimated profit of the seller's current band choices; the best-case tile
 * carries the one-click "apply best band to all" action so the seller can jump
 * straight to the optimum and adjust down from there.
 */
export function CommissionTariffsSummary({
  summary,
  onApplyBest,
}: CommissionTariffsSummaryProps): React.ReactElement {
  const t = useTranslations('commissionTariffsPage.summary');
  const formatter = useFormatter();

  return (
    <StatGroup>
      <StatCard
        label={t('total')}
        value={formatter.number(summary.total, 'integer')}
        context={t('totalContext')}
      />
      <StatCard
        label={t('selected')}
        value={t('selectedValue', { count: summary.selectedCount, total: summary.total })}
        context={t('selectedContext')}
      />
      <StatCard
        label={t('selectedProfit')}
        value={<Currency value={summary.selectedProfit} />}
        emphasis
        context={t('selectedProfitContext')}
      />
      <StatCard
        label={t('bestProfit')}
        value={<Currency value={summary.bestProfit} />}
        hint={t('bestProfitHint')}
        action={
          <Button variant="outline" size="sm" onClick={onApplyBest}>
            {t('applyBest')}
          </Button>
        }
      />
    </StatGroup>
  );
}
