'use client';

import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { StatCard } from '@/components/patterns/stat-card';
import { StatGroup } from '@/components/patterns/stat-group';

import type { TariffSelectionSummary } from '../lib/commission-tariff-summary';

export interface CommissionTariffsSummaryProps {
  summary: TariffSelectionSummary;
}

/**
 * Header KPI strip for the Product Commission Tariffs page. The headline is the
 * estimated profit of the seller's current band choices; the best-case tile is
 * the target the seller can reach via the action bar's "apply best to all".
 */
export function CommissionTariffsSummary({
  summary,
}: CommissionTariffsSummaryProps): React.ReactElement {
  const t = useTranslations('commissionTariffsPage.summary');
  const formatter = useFormatter();
  // No tariff loaded yet: render the strip as a quiet scaffold (em-dashes).
  const empty = summary.total === 0;
  const dash = '—';

  return (
    <StatGroup>
      <StatCard
        label={t('total')}
        value={empty ? dash : formatter.number(summary.total, 'integer')}
        context={t('totalContext')}
      />
      <StatCard
        label={t('selected')}
        value={
          empty ? dash : t('selectedValue', { count: summary.selectedCount, total: summary.total })
        }
        context={t('selectedContext')}
      />
      <StatCard
        label={t('selectedProfit')}
        value={empty ? dash : <Currency value={summary.selectedProfit} />}
        emphasis
        context={t('selectedProfitContext')}
      />
      <StatCard
        label={t('bestProfit')}
        value={empty ? dash : <Currency value={summary.bestProfit} />}
        hint={t('bestProfitHint')}
      />
    </StatGroup>
  );
}
