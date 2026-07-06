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

import type { PlusTariffListStats } from '../lib/plus-tariff-list';

const DASH = '—';

/**
 * Liveliness layer: each cell's circular icon carries a SOFT tone fill (pale
 * surface + tone icon). Tones follow meaning — brand for the headline count,
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

export interface PlusTariffListSummaryProps {
  stats: PlusTariffListStats;
  /**
   * Render the strip's per-cell skeletons (real labels/icons stay mounted)
   * while the list query is in flight — avoids a misleading flash of zeros.
   */
  loading?: boolean;
}

/**
 * At-a-glance summary band for the Plus tariff list: total tariffs, which period
 * is live now, how many products are opted in to Plus in that period, and how
 * many tariffs are exported. Always rendered (even with zero tariffs, where it
 * reads zeros / em-dashes) so the page never collapses to an empty shell.
 */
export function PlusTariffListSummary({
  stats,
  loading = false,
}: PlusTariffListSummaryProps): React.ReactElement {
  const t = useTranslations('plusCommissionTariffsPage.list.summary');
  const tCommon = useTranslations('common');
  const format = useFormatter();

  const pendingExports = stats.total - stats.exportedCount;

  // Only the NON-ZERO validity buckets. Order: what's live, what's next, then
  // history. Plus has no draft bucket — every PARSEABLE row lands in one of these,
  // so they reconcile with the total (a null validity is a rare parse edge case
  // that stays uncounted, mirroring the lib's PlusTariffListStats contract).
  const bucketParts = (
    [
      ['bucketActive', stats.activeCount],
      ['bucketUpcoming', stats.upcomingCount],
      ['bucketPast', stats.pastCount],
    ] as const
  )
    .filter(([, count]) => count > 0)
    .map(([key, count]) => t(key, { count }));

  const items: StatStripItem[] = [
    {
      label: t('total'),
      value: format.number(stats.total, 'integer'),
      context: bucketParts.length > 0 ? bucketParts.join(' · ') : undefined,
      icon: circleIcon(<DocumentValidationIcon />, 'primary'),
    },
    {
      // An empty metric gets real microcopy in the CONTEXT line — the value
      // keeps the em-dash for scan-ability, but the reader learns WHY.
      label: t('activePeriod'),
      value: stats.activeLabel ?? DASH,
      context: stats.activeLabel === null ? t('noActivePeriod') : t('activeNow'),
      icon: circleIcon(<Calendar01Icon />, 'info'),
    },
    {
      // Plus participation in the active period: how many products are opted in.
      // null (no active period) reads DASH; the context nudges toward joining.
      label: t('joined'),
      value: stats.joinedCount === null ? DASH : format.number(stats.joinedCount, 'integer'),
      context:
        stats.joinedCount !== null && stats.joinedCount > 0 ? t('joinedContext') : t('noJoined'),
      icon: circleIcon(<PackageIcon />, 'primary'),
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
