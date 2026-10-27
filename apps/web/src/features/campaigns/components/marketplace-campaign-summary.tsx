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

export interface MarketplaceCampaignSummaryProps {
  /** Every product in the campaign — `rows.length`. */
  itemCount: number;
  /** Rows the buffer joins at the maximum price. */
  maxCount: number;
  /** Rows the buffer joins at a custom price. */
  customCount: number;
}

/**
 * Header KPI strip for an open Kampanyalar campaign — counts only (Berkin's decision, 2026-10-23,
 * like İndirimler): the product count and how many join, split by price option. The choices are
 * the detail's LOCAL buffer, so these are buffer counts, not server figures, and there is no money
 * stat.
 */
export function MarketplaceCampaignSummary({
  itemCount,
  maxCount,
  customCount,
}: MarketplaceCampaignSummaryProps): React.ReactElement {
  const t = useTranslations('marketplaceCampaignsPage.summary');
  const format = useFormatter();
  const integer = (value: number): string => format.number(value, 'integer');

  const items: StatStripItem[] = [
    {
      label: t('total'),
      value: integer(itemCount),
      icon: circleIcon(<PackageIcon />, 'primary'),
    },
    {
      label: t('selected'),
      value: t('selectedValue', {
        count: integer(maxCount + customCount),
        total: integer(itemCount),
      }),
      context: t('selectedContext', { max: integer(maxCount), custom: integer(customCount) }),
      icon: circleIcon(<TaskDone01Icon />, 'info'),
    },
  ];

  return <StatStrip items={items} surface="bare" size="md" />;
}
