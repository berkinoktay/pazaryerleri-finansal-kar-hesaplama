'use client';

import { PackageIcon, TaskDone01Icon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { StatStrip, type StatStripItem } from '@/components/patterns/stat-strip';
import { SoftSquareIcon } from '@/components/ui/soft-square-icon';

const circleIcon = (
  icon: React.ReactNode,
  tone: React.ComponentProps<typeof SoftSquareIcon>['tone'],
): React.ReactElement => (
  <SoftSquareIcon shape="circle" variant="soft" tone={tone} size="lg">
    {icon}
  </SoftSquareIcon>
);

export interface DiscountItemsSummaryProps {
  /** Total product count on the list — `rows.length`. */
  itemCount: number;
  /** How many the seller has included — the detail client's EPHEMERAL local selection size. */
  selectedCount: number;
}

/**
 * Header KPI strip for an open İndirimler list — two counts only: the total product count and how
 * many the seller has included. Selection is ephemeral client state, so `selectedCount` is the
 * local selection size (not a server figure) and there are no monetary stats.
 */
export function DiscountItemsSummary({
  itemCount,
  selectedCount,
}: DiscountItemsSummaryProps): React.ReactElement {
  const t = useTranslations('discountsPage.summary');
  const format = useFormatter();

  const items: StatStripItem[] = [
    {
      label: t('total'),
      value: format.number(itemCount, 'integer'),
      icon: circleIcon(<PackageIcon />, 'primary'),
    },
    {
      label: t('selected'),
      value: format.number(selectedCount, 'integer'),
      icon: circleIcon(<TaskDone01Icon />, 'info'),
    },
  ];

  return <StatStrip items={items} surface="bare" size="md" />;
}
