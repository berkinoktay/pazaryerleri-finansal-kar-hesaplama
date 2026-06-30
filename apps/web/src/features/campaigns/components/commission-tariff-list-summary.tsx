'use client';

import {
  Calendar01Icon,
  DocumentValidationIcon,
  Download04Icon,
  PackageIcon,
} from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { StatStrip, type StatStripItem } from '@/components/patterns/stat-strip';
import { SoftSquareIcon } from '@/components/ui/soft-square-icon';

import type { TariffListStats } from '../lib/commission-tariff-list';

const DASH = '—';

/**
 * Matches the design showcase's StatStrip icon treatment: a top-right circular
 * hairline (outline) chip per cell — adds liveliness without color overload.
 */
const circleIcon = (icon: React.ReactNode): React.ReactElement => (
  <SoftSquareIcon shape="circle" variant="outline" size="lg">
    {icon}
  </SoftSquareIcon>
);

export interface CommissionTariffListSummaryProps {
  stats: TariffListStats;
}

/**
 * At-a-glance summary band for the tariff list: total tariffs, which period is
 * live now, how many products it covers, and how many tariffs are exported.
 * Always rendered (even with zero tariffs, where it reads zeros / em-dashes) so
 * the page never collapses to an empty shell.
 */
export function CommissionTariffListSummary({
  stats,
}: CommissionTariffListSummaryProps): React.ReactElement {
  const t = useTranslations('commissionTariffsPage.list.summary');
  const format = useFormatter();

  const items: StatStripItem[] = [
    {
      label: t('total'),
      value: format.number(stats.total, 'integer'),
      icon: circleIcon(<DocumentValidationIcon />),
    },
    {
      label: t('activePeriod'),
      value: stats.activeLabel ?? DASH,
      icon: circleIcon(<Calendar01Icon />),
    },
    {
      label: t('covered'),
      value:
        stats.coveredProducts === null ? DASH : format.number(stats.coveredProducts, 'integer'),
      icon: circleIcon(<PackageIcon />),
    },
    {
      label: t('exported'),
      value: t('exportedValue', { count: stats.exportedCount, total: stats.total }),
      icon: circleIcon(<Download04Icon />),
    },
  ];

  return <StatStrip items={items} />;
}
