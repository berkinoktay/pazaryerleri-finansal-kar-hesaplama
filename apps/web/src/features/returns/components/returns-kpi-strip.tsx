'use client';

import Decimal from 'decimal.js';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { formatNumber } from '@pazarsync/utils';

import { Currency } from '@/components/patterns/currency';
import { StatCard } from '@/components/patterns/stat-card';
import { StatGroup } from '@/components/patterns/stat-group';

import type { ClaimsSummary } from '../api/get-claims-summary.api';

/** Keys available under the `returnsPage.kpi` i18n namespace. */
type KpiKey = 'open' | 'resolvedInPeriod' | 'refundDeduction' | 'netImpact';

interface KpiCardDescriptor {
  key: KpiKey;
  value: (s: ClaimsSummary) => React.ReactNode;
}

/**
 * The four returns KPIs (spec §6): current open-claim workload, period
 * resolution count, the period's gross refund deduction, and the net profit
 * impact (−deduction + commission refund + cost return — usually negative,
 * tinted destructive when it is). Counts run on claimDate, money on
 * OrderFee.capturedAt — the backend owns both axes; no FE re-derivation.
 */
const KPI_CARDS: KpiCardDescriptor[] = [
  {
    key: 'open',
    value: (s) => formatNumber(s.openCount),
  },
  {
    key: 'resolvedInPeriod',
    value: (s) => formatNumber(s.resolvedInPeriod),
  },
  {
    key: 'refundDeduction',
    value: (s) => <Currency value={s.refundDeductionGross} />,
  },
  {
    key: 'netImpact',
    value: (s) => (
      <Currency
        value={s.netImpactGross}
        className={new Decimal(s.netImpactGross).isNegative() ? 'text-destructive' : undefined}
      />
    ),
  },
];

export interface ReturnsKpiStripProps {
  summary: ClaimsSummary | undefined;
  loading: boolean;
  error?: boolean;
}

export function ReturnsKpiStrip({
  summary,
  loading,
  error = false,
}: ReturnsKpiStripProps): React.ReactElement {
  const t = useTranslations('returnsPage.kpi');
  const status: 'ready' | 'loading' | 'error' = loading ? 'loading' : error ? 'error' : 'ready';

  return (
    <StatGroup>
      {KPI_CARDS.map((card) => (
        <StatCard
          key={card.key}
          status={status}
          label={t(card.key)}
          value={summary !== undefined ? card.value(summary) : null}
        />
      ))}
    </StatGroup>
  );
}
