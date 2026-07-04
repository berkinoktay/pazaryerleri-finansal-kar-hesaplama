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

import { useCommissionTariffLabel } from '../hooks/use-commission-tariff-label';
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
  /**
   * Render the strip's per-cell skeletons (real labels/icons stay mounted)
   * while the list query is in flight — avoids a misleading flash of zeros.
   */
  loading?: boolean;
}

/**
 * At-a-glance summary band for the tariff list: total tariffs, which period is
 * live now, how many products it covers, and how many tariffs are exported.
 * Always rendered (even with zero tariffs, where it reads zeros / em-dashes) so
 * the page never collapses to an empty shell.
 */
export function CommissionTariffListSummary({
  stats,
  loading = false,
}: CommissionTariffListSummaryProps): React.ReactElement {
  const t = useTranslations('commissionTariffsPage.list.summary');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const commissionTariffLabel = useCommissionTariffLabel();

  const pendingExports = stats.total - stats.exportedCount;

  // The "Aktif dönem" cell shows the live tariff's WEEK WINDOW (the same long
  // stamp the upload picker and detail header use), not its file name — the
  // seller reads which period is in effect. Falls back to the name when the
  // dates are unparseable, and to an em-dash when nothing is live.
  const activePeriodLabel =
    stats.activeLabel === null
      ? DASH
      : commissionTariffLabel({
          weekStartsAt: stats.activeWeekStartsAt,
          weekEndsAt: stats.activeWeekEndsAt,
          name: stats.activeLabel,
        });

  // Only the NON-ZERO validity buckets, so the line always reconciles with the
  // total ("Toplam 5 — 1 aktif · 0 taslak" hid 4 expired tariffs; all-expired
  // read as if the tariffs vanished). Order: what's live, what's next, what
  // needs work, then history.
  const bucketParts = (
    [
      ['bucketActive', stats.activeCount],
      ['bucketUpcoming', stats.upcomingCount],
      ['bucketDraft', stats.draftCount],
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
      value: activePeriodLabel,
      context: stats.activeLabel === null ? t('noActivePeriod') : t('activeNow'),
      icon: circleIcon(<Calendar01Icon />, 'info'),
    },
    {
      label: t('covered'),
      value:
        stats.coveredProducts === null ? DASH : format.number(stats.coveredProducts, 'integer'),
      context: stats.coveredProducts === null ? t('noActivePeriod') : t('coveredContext'),
      // primary, NOT neutral: a gray bg-muted chip beside three tinted
      // siblings read as broken/unfinished (self-reviewed live). The strip
      // now alternates primary / info / primary / semantic.
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

  return <StatStrip items={items} loading={loading} loadingLabel={tCommon('loading')} />;
}
