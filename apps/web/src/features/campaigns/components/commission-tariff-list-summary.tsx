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
 * Liveliness layer: each cell's circular icon carries a SOFT tone fill (pale
 * surface + tone icon) instead of the old pale-gray outline that washed out
 * on the tinted canvas. Tones follow meaning — brand for the headline count,
 * info for the calendar dimension, semantic success/warning for the export
 * progress — never a full saturated fill (one accent per region discipline).
 */
const circleIcon = (
  icon: React.ReactNode,
  tone: React.ComponentProps<typeof SoftSquareIcon>['tone'],
): React.ReactElement => (
  <SoftSquareIcon shape="circle" variant="soft" tone={tone} size="lg">
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

  const pendingExports = stats.total - stats.exportedCount;

  const items: StatStripItem[] = [
    {
      label: t('total'),
      value: format.number(stats.total, 'integer'),
      icon: circleIcon(<DocumentValidationIcon />, 'primary'),
    },
    {
      // An empty metric gets real microcopy in the CONTEXT line — the value
      // keeps the em-dash for scan-ability, but the reader learns WHY.
      label: t('activePeriod'),
      value: stats.activeLabel ?? DASH,
      context: stats.activeLabel === null ? t('noActivePeriod') : undefined,
      icon: circleIcon(<Calendar01Icon />, 'info'),
    },
    {
      label: t('covered'),
      value:
        stats.coveredProducts === null ? DASH : format.number(stats.coveredProducts, 'integer'),
      context: stats.coveredProducts === null ? t('noActivePeriod') : t('coveredContext'),
      icon: circleIcon(<PackageIcon />, 'neutral'),
    },
    {
      // Export progress carries the semantic signal: all-done reads success,
      // anything pending nudges with the remaining count.
      label: t('exported'),
      value: t('exportedValue', { count: stats.exportedCount, total: stats.total }),
      context:
        stats.total === 0
          ? undefined
          : pendingExports === 0
            ? t('exportedAllDone')
            : t('exportedPending', { count: pendingExports }),
      // total===0 is the FIRST-RUN state, not a problem — an amber chip on
      // "0 / 0" would be a false alarm. Neutral until there is work to do.
      icon: circleIcon(
        <Download04Icon />,
        stats.total === 0 ? 'neutral' : pendingExports === 0 ? 'success' : 'warning',
      ),
    },
  ];

  return <StatStrip items={items} />;
}
