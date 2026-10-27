'use client';

import { Alert02Icon, Edit02Icon, InformationCircleIcon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { Button } from '@/components/ui/button';

import type { MarketplaceCampaignHeader } from '../lib/adapt-marketplace-campaign';
import { useDescribeDiscountConfig } from '../lib/discount-config';
import { DiscountTypeBadge } from './discount-type-badge';
import { MarketplaceCampaignFundingBadge } from './marketplace-campaign-funding-badge';

export interface MarketplaceCampaignConfigCardProps {
  /** The saved campaign — its kurgu, parameters, Trendyol funding rate and window. */
  header: MarketplaceCampaignHeader;
  /** Opens the config-edit dialog. */
  onEdit: () => void;
}

/**
 * The Kampanyalar detail's configuration header: the kurgu badge + a one-line human summary
 * ("Sepette ₺1.000,00 üzeri %20"), Trendyol's funding rate (hidden at 0 %), the campaign window
 * and — for every kurgu with a condition, i.e. all but NET — the single-product-basket assumption
 * the estimates rest on. "Düzenle" reopens the config in an edit dialog; saving there recomputes
 * every row.
 */
export function MarketplaceCampaignConfigCard({
  header,
  onEdit,
}: MarketplaceCampaignConfigCardProps): React.ReactElement {
  const t = useTranslations('marketplaceCampaignsPage.configCard');
  const describe = useDescribeDiscountConfig();
  const formatter = useFormatter();

  // Deterministic parse of the server ISO strings (no `Date.now()`), so server and client render
  // byte-identical; the window shows only when both ends are present.
  const windowLabel =
    header.startsAt !== null && header.endsAt !== null
      ? t('dateRange', {
          start: formatter.dateTime(new Date(header.startsAt), 'dayTime'),
          end: formatter.dateTime(new Date(header.endsAt), 'dayTime'),
        })
      : null;

  return (
    <div className="border-border bg-card gap-sm p-md flex flex-col rounded-lg border">
      <div className="gap-sm flex flex-wrap items-start justify-between">
        <div className="gap-2xs flex min-w-0 flex-col">
          <div className="gap-sm flex flex-wrap items-center">
            <DiscountTypeBadge type={header.discountType} />
            <span className="text-foreground text-sm font-medium">{describe(header)}</span>
            <MarketplaceCampaignFundingBadge fundingPct={header.trendyolFundingPct} />
          </div>
          {windowLabel !== null ? (
            <span className="text-2xs text-muted-foreground tabular-nums">{windowLabel}</span>
          ) : null}
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={onEdit}
          leadingIcon={<Edit02Icon aria-hidden />}
          className="shrink-0"
        >
          {t('edit')}
        </Button>
      </div>

      {header.discountType !== 'NET' ? (
        <div className="gap-2xs text-2xs text-muted-foreground flex items-start">
          <InformationCircleIcon className="size-icon-xs mt-3xs shrink-0" aria-hidden />
          <span>{t('assumption')}</span>
        </div>
      ) : null}

      {header.commissionTariffOutdated ? (
        <div className="gap-2xs text-warning text-2xs flex items-start">
          <Alert02Icon className="size-icon-xs mt-3xs shrink-0" aria-hidden />
          <span>{t('outdatedTariffNote')}</span>
        </div>
      ) : null}
    </div>
  );
}
