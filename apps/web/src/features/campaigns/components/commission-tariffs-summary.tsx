'use client';

import { Coins01Icon, PackageIcon, SparklesIcon, TaskDone01Icon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { StatStrip, type StatStripItem } from '@/components/patterns/stat-strip';
import { SoftSquareIcon } from '@/components/ui/soft-square-icon';

import type { TariffSelectionSummary } from '../lib/commission-tariff-summary';

const DASH = '—';

const circleIcon = (
  icon: React.ReactNode,
  tone: React.ComponentProps<typeof SoftSquareIcon>['tone'],
): React.ReactElement => (
  <SoftSquareIcon shape="circle" variant="soft" tone={tone} size="lg">
    {icon}
  </SoftSquareIcon>
);

export interface CommissionTariffsSummaryProps {
  summary: TariffSelectionSummary;
}

/**
 * Header KPI strip for an open tariff: products in the period, how many bands the
 * seller has chosen, the estimated profit of those choices, and the best-case
 * target. Mirrors the list's StatStrip (soft-toned circular icons); the "best vs selected"
 * headroom is surfaced as a nudge in the sticky action bar rather than here.
 */
export function CommissionTariffsSummary({
  summary,
}: CommissionTariffsSummaryProps): React.ReactElement {
  const t = useTranslations('commissionTariffsPage.summary');
  const format = useFormatter();
  const empty = summary.total === 0;

  const items: StatStripItem[] = [
    {
      label: t('total'),
      value: empty ? DASH : format.number(summary.total, 'integer'),
      // primary, NOT neutral — same call as the list strip's headline count:
      // a gray bg-muted chip beside three tinted siblings reads broken.
      icon: circleIcon(<PackageIcon />, 'primary'),
    },
    {
      label: t('selected'),
      value: empty
        ? DASH
        : t('selectedValue', { count: summary.selectedCount, total: summary.total }),
      icon: circleIcon(<TaskDone01Icon />, 'info'),
    },
    {
      label: t('selectedProfit'),
      value: empty ? DASH : <Currency value={summary.selectedProfit} />,
      icon: circleIcon(<Coins01Icon />, 'success'),
    },
    {
      label: t('bestProfit'),
      value: empty ? DASH : <Currency value={summary.bestProfit} />,
      hint: t('bestProfitHint'),
      icon: circleIcon(<SparklesIcon />, 'primary'),
    },
  ];

  return <StatStrip items={items} />;
}
