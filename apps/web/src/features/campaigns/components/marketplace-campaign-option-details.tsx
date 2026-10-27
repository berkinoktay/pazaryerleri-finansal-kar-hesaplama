'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { formatCurrency } from '@pazarsync/utils';

import { formatPercentDisplay } from '@/lib/format-percent';

import type { CampaignCommissionBand } from '../lib/adapt-marketplace-campaign';
import type { CampaignOptionFigures } from '../lib/marketplace-campaign-selection';
import { CommissionBandsPopover, type CommissionBandsLabels } from './commission-bands-popover';

/**
 * The Kampanyalar band-range + popover-chrome templates, bound to
 * `marketplaceCampaignsPage.commissionBands` — the ONE shared {@link CommissionBandsPopover}
 * takes its labels as props, so no vertical's namespace is hard-coded into it.
 */
function useCampaignCommissionBandLabels(): CommissionBandsLabels {
  const t = useTranslations('marketplaceCampaignsPage.commissionBands');
  return {
    above: (price) => t('above', { price }),
    range: (lower, upper) => t('range', { lower, upper }),
    below: (price) => t('below', { price }),
    title: t('title'),
    hint: t('hint'),
  };
}

export interface CampaignOptionDetailsProps {
  /** The assumed order an ORDER-framed card describes; null on a per-unit card. */
  order: CampaignOptionFigures['order'];
  /** The option's commission percent; null hides the line. */
  commissionPct: string | null;
  /** The item's band ladder behind the ⓘ popover; null when no tariff bands resolved. */
  commissionBands: readonly CampaignCommissionBand[] | null;
}

/**
 * The quiet lines under a price card's hero price, shared by the maximum and the custom card so
 * the two read alike: on an ORDER row the assumed order ("3 adetlik sipariş" + what the customer
 * pays for it), then the option's commission with the band ladder a seller can open.
 */
export function CampaignOptionDetails({
  order,
  commissionPct,
  commissionBands,
}: CampaignOptionDetailsProps): React.ReactElement | null {
  const t = useTranslations('marketplaceCampaignsPage.table');
  const bandLabels = useCampaignCommissionBandLabels();
  if (order === null && commissionPct === null) return null;

  return (
    <div className="gap-3xs text-2xs text-muted-foreground flex flex-col items-start tabular-nums">
      {order !== null ? (
        <>
          <span>{t('orderQuantity', { qty: order.quantity })}</span>
          <span>{t('customerPays', { amount: formatCurrency(order.paidTotal) })}</span>
        </>
      ) : null}
      {commissionPct !== null ? (
        <span className="gap-3xs inline-flex items-center">
          {t('commission')} {formatPercentDisplay(commissionPct)}
          {commissionBands !== null && commissionBands.length > 0 ? (
            // Raised above the maximum card's stretched select overlay so the ⓘ stays clickable
            // (the card's `isolate` keeps the z-index local to it).
            <span className="relative z-10 inline-flex">
              <CommissionBandsPopover bands={commissionBands} labels={bandLabels} />
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
