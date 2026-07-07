'use client';

import { ChartLineData01Icon, Coins01Icon, PackageIcon, TaskDone01Icon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { StatStrip, type StatStripItem } from '@/components/patterns/stat-strip';
import { SoftSquareIcon } from '@/components/ui/soft-square-icon';

import type { FlashProductSummary } from '../lib/flash-product-summary';

const DASH = '—';

const circleIcon = (
  icon: React.ReactNode,
  tone: React.ComponentProps<typeof SoftSquareIcon>['tone'],
): React.ReactElement => (
  <SoftSquareIcon shape="circle" variant="soft" tone={tone} size="lg">
    {icon}
  </SoftSquareIcon>
);

export interface FlashProductsSummaryProps {
  summary: FlashProductSummary;
}

/**
 * Header KPI strip for an open Flash Products list: offer rows in the upload, how many the
 * seller has chosen an offer (or custom price) for, the estimated profit of those chosen
 * rows, and the "do nothing" current-profit baseline. Mirrors the list's StatStrip
 * (soft-toned circular icons). The chosen-vs-current comparison is the core question the
 * screen answers, so both profit figures sit side by side.
 */
export function FlashProductsSummary({ summary }: FlashProductsSummaryProps): React.ReactElement {
  const t = useTranslations('flashProductsPage.summary');
  const format = useFormatter();
  const empty = summary.total === 0;

  const items: StatStripItem[] = [
    {
      label: t('total'),
      value: empty ? DASH : format.number(summary.total, 'integer'),
      context: empty ? undefined : t('totalContext'),
      icon: circleIcon(<PackageIcon />, 'primary'),
    },
    {
      label: t('joined'),
      value: empty ? DASH : t('joinedValue', { count: summary.joinedCount, total: summary.total }),
      context: empty ? undefined : t('joinedContext'),
      icon: circleIcon(<TaskDone01Icon />, 'info'),
    },
    {
      label: t('joinedProfit'),
      value: empty ? DASH : <Currency value={summary.joinedProfit} />,
      context: empty ? undefined : t('joinedProfitContext'),
      icon: circleIcon(<Coins01Icon />, 'success'),
    },
    {
      label: t('currentProfit'),
      value: empty ? DASH : <Currency value={summary.currentProfit} />,
      hint: t('currentProfitHint'),
      icon: circleIcon(<ChartLineData01Icon />, 'primary'),
    },
  ];

  return <StatStrip items={items} surface="bare" size="md" />;
}
