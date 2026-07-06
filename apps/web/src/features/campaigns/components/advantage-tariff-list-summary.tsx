'use client';

import {
  DocumentValidationIcon,
  Download04Icon,
  PackageIcon,
  TaskDone01Icon,
} from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { StatStrip, type StatStripItem } from '@/components/patterns/stat-strip';
import { SoftSquareIcon } from '@/components/ui/soft-square-icon';

import type { AdvantageTariffListStats } from '../lib/advantage-tariff-list';

/**
 * Liveliness layer: each cell's circular icon carries a SOFT tone fill (pale surface +
 * tone icon). Tones follow meaning — brand for the headline count, info for the product
 * dimension, semantic success/warning for the export progress — never a full saturated
 * fill (one accent per region discipline).
 */
const circleIcon = (
  icon: React.ReactNode,
  tone: React.ComponentProps<typeof SoftSquareIcon>['tone'],
): React.ReactElement => (
  <SoftSquareIcon shape="circle" variant="soft" tone={tone} size="lg">
    {icon}
  </SoftSquareIcon>
);

export interface AdvantageTariffListSummaryProps {
  stats: AdvantageTariffListStats;
  /**
   * Render the strip's per-cell skeletons (real labels/icons stay mounted) while the
   * list query is in flight — avoids a misleading flash of zeros.
   */
  loading?: boolean;
}

/**
 * At-a-glance summary band for the Advantage tariff list: total tariffs, products listed
 * across them, products with a chosen tier, and how many tariffs are exported. Always
 * rendered (even with zero tariffs, where it reads zeros / em-dashes) so the page never
 * collapses to an empty shell. Unlike the commission/Plus lists there is no active-period
 * cell — an Advantage file carries no dates.
 */
export function AdvantageTariffListSummary({
  stats,
  loading = false,
}: AdvantageTariffListSummaryProps): React.ReactElement {
  const t = useTranslations('productLabelsPage.list.summary');
  const tCommon = useTranslations('common');
  const format = useFormatter();

  const items: StatStripItem[] = [
    {
      // The export split (exported vs pending) is carried in full by the dedicated
      // "exported" cell below, so the total cell stays a clean headline count.
      label: t('total'),
      value: format.number(stats.total, 'integer'),
      icon: circleIcon(<DocumentValidationIcon />, 'primary'),
    },
    {
      label: t('products'),
      value: format.number(stats.productTotal, 'integer'),
      context: stats.total === 0 ? undefined : t('productsContext'),
      icon: circleIcon(<PackageIcon />, 'info'),
    },
    {
      // Products with a chosen advantage tier across all tariffs.
      label: t('selected'),
      value: format.number(stats.selectedTotal, 'integer'),
      context:
        stats.selectedTotal > 0
          ? t('selectedContext')
          : stats.total === 0
            ? undefined
            : t('noSelected'),
      icon: circleIcon(<TaskDone01Icon />, 'primary'),
    },
    {
      // Export progress carries the semantic signal: all-done reads success, anything
      // pending nudges with the remaining count.
      label: t('exported'),
      value: t('exportedValue', { count: stats.exportedCount, total: stats.total }),
      context:
        stats.total === 0
          ? undefined
          : stats.pendingCount === 0
            ? t('exportedAllDone')
            : t('exportedPending', { count: stats.pendingCount }),
      // total===0 is the FIRST-RUN state, not a problem — an amber chip on "0 / 0" would
      // be a false alarm. Neutral until there is work to do.
      icon: circleIcon(
        <Download04Icon />,
        stats.total === 0 ? 'neutral' : stats.pendingCount === 0 ? 'success' : 'warning',
      ),
    },
  ];

  return (
    <StatStrip
      items={items}
      loading={loading}
      loadingLabel={tCommon('loading')}
      surface="bare"
      size="md"
    />
  );
}
