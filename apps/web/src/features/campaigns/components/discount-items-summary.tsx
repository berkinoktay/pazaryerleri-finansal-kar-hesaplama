'use client';

import { ChartLineData01Icon, Coins01Icon, PackageIcon, TaskDone01Icon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { StatStrip, type StatStripItem } from '@/components/patterns/stat-strip';
import { SoftSquareIcon } from '@/components/ui/soft-square-icon';

import type { DiscountListSummary } from '../api/get-discount-list-detail.api';

const DASH = '—';

const circleIcon = (
  icon: React.ReactNode,
  tone: React.ComponentProps<typeof SoftSquareIcon>['tone'],
): React.ReactElement => (
  <SoftSquareIcon shape="circle" variant="soft" tone={tone} size="lg">
    {icon}
  </SoftSquareIcon>
);

export interface DiscountItemsSummaryProps {
  summary: DiscountListSummary;
}

/**
 * Header KPI strip for an open İndirimler list — renders ONLY the backend `summary` block: the
 * product count, how many the seller has included, the per-order discount cost, and the average
 * profit impact of including the discount. Every figure is server-computed (Görev 9); the
 * frontend derives nothing.
 */
export function DiscountItemsSummary({ summary }: DiscountItemsSummaryProps): React.ReactElement {
  const t = useTranslations('discountsPage.summary');
  const format = useFormatter();

  const items: StatStripItem[] = [
    {
      label: t('total'),
      value: format.number(summary.itemCount, 'integer'),
      icon: circleIcon(<PackageIcon />, 'primary'),
    },
    {
      label: t('selected'),
      value: format.number(summary.selectedCount, 'integer'),
      icon: circleIcon(<TaskDone01Icon />, 'info'),
    },
    {
      label: t('perOrderCost'),
      value: <Currency value={summary.perOrderCost} />,
      icon: circleIcon(<Coins01Icon />, 'warning'),
    },
    {
      label: t('avgImpact'),
      value: summary.avgProfitDelta === null ? DASH : <Currency value={summary.avgProfitDelta} />,
      icon: circleIcon(<ChartLineData01Icon />, 'success'),
    },
  ];

  return <StatStrip items={items} surface="bare" size="md" />;
}
