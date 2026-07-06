'use client';

import Decimal from 'decimal.js';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { formatNumber } from '@pazarsync/utils';

import { Currency } from '@/components/patterns/currency';
import { StatStrip, type StatStripItem } from '@/components/patterns/stat-strip';

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
}

/**
 * Four returns KPIs docked into the returns PageHeader summary slot, scoped to
 * the header's date range. Rendered as a bare StatStrip so the framed header
 * owns the surface; loading shows skeletons while keeping the real labels. The
 * page omits this strip on a summary-query error with no cached data, so no
 * error branch lives here.
 */
export function ReturnsKpiStrip({ summary, loading }: ReturnsKpiStripProps): React.ReactElement {
  const t = useTranslations('returnsPage.kpi');
  const tCommon = useTranslations('common');

  const items: StatStripItem[] = KPI_CARDS.map((card) => ({
    label: t(card.key),
    value: summary !== undefined ? card.value(summary) : null,
  }));

  return (
    <StatStrip
      surface="bare"
      size="md"
      items={items}
      loading={loading}
      loadingLabel={tCommon('loading')}
    />
  );
}
