'use client';

import { ChartLineData01Icon, Coins01Icon, PackageIcon, TaskDone01Icon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { StatStrip, type StatStripItem } from '@/components/patterns/stat-strip';
import { SoftSquareIcon } from '@/components/ui/soft-square-icon';

import type { PlusTariffSummary } from '../lib/plus-tariff-summary';

const DASH = '—';

const circleIcon = (
  icon: React.ReactNode,
  tone: React.ComponentProps<typeof SoftSquareIcon>['tone'],
): React.ReactElement => (
  <SoftSquareIcon shape="circle" variant="soft" tone={tone} size="lg">
    {icon}
  </SoftSquareIcon>
);

export interface PlusTariffsSummaryProps {
  summary: PlusTariffSummary;
}

/**
 * Header KPI strip for an open Plus tariff: products in the window, how many the
 * seller has joined Plus for, the estimated profit of the joined products, and the
 * "do nothing" current-profit baseline. Mirrors the list's StatStrip (soft-toned
 * circular icons). The join-vs-current comparison is the core question the screen
 * answers, so both profit figures sit side by side.
 */
export function PlusTariffsSummary({ summary }: PlusTariffsSummaryProps): React.ReactElement {
  const t = useTranslations('plusCommissionTariffsPage.summary');
  const format = useFormatter();
  const empty = summary.total === 0;

  const items: StatStripItem[] = [
    {
      label: t('total'),
      value: empty ? DASH : format.number(summary.total, 'integer'),
      context: empty ? undefined : t('totalContext'),
      // primary, NOT neutral — same call as the list strip's headline count.
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
