'use client';

import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

const EM_DASH = '—';

export interface MarketplaceCampaignPeriodProps {
  startsAt: string | null;
  endsAt: string | null;
}

/**
 * The campaign window as a compact "01.08.2026 – 07.08.2026" stamp, shared by the list table and
 * the mobile cards. A deterministic parse of the server ISO strings (no `Date.now()`), so server
 * and client render byte-identical. The window is required on upload but nullable in the DB, so a
 * missing end reads as an em-dash rather than a half range.
 */
export function MarketplaceCampaignPeriod({
  startsAt,
  endsAt,
}: MarketplaceCampaignPeriodProps): React.ReactElement {
  const t = useTranslations('marketplaceCampaignsPage.list');
  const format = useFormatter();

  if (startsAt === null || endsAt === null) {
    return <span className="text-muted-foreground">{EM_DASH}</span>;
  }
  return (
    <span className="text-muted-foreground text-2xs whitespace-nowrap tabular-nums">
      {t('dateRange', {
        start: format.dateTime(new Date(startsAt), 'date'),
        end: format.dateTime(new Date(endsAt), 'date'),
      })}
    </span>
  );
}
