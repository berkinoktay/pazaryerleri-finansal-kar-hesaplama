'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';

export interface StoreSummary {
  commissionPercent: number;
  activeProducts: number;
  apiHealth: 'healthy' | 'degraded' | 'down';
  lastSyncedLabel: string;
}

export interface StoreSummaryCardProps {
  data: StoreSummary | undefined;
}

const HEALTH_TONE = {
  healthy: 'text-success',
  degraded: 'text-warning',
  down: 'text-destructive',
} as const;

const HEALTH_LABEL_KEY = {
  healthy: 'storeSummary.health.healthy',
  degraded: 'storeSummary.health.degraded',
  down: 'storeSummary.health.down',
} as const;

/**
 * Compact "store at a glance" card for the Dashboard ContextRail
 * middle. Three quiet rows — commission, active SKUs, API health.
 * Shows skeleton dashes when `data` is undefined.
 */
export function StoreSummaryCard({ data }: StoreSummaryCardProps): React.ReactElement {
  const t = useTranslations();
  return (
    <div className="gap-2xs flex flex-col">
      <span className="px-xs text-2xs text-muted-foreground font-semibold tracking-wide uppercase">
        {t('storeSummary.heading')}
      </span>
      <div className="gap-xs px-xs py-xs flex flex-col text-sm">
        <Row
          label={t('storeSummary.commission')}
          value={data ? `%${data.commissionPercent.toFixed(1)}` : '—'}
        />
        <Row
          label={t('storeSummary.activeProducts')}
          value={data ? String(data.activeProducts) : '—'}
        />
        <Row
          label={t('storeSummary.apiHealth')}
          value={
            data ? (
              <span className={cn('font-medium', HEALTH_TONE[data.apiHealth])}>
                ● {t(HEALTH_LABEL_KEY[data.apiHealth])}
              </span>
            ) : (
              '—'
            )
          }
        />
        <Row label={t('storeSummary.lastSync')} value={data ? data.lastSyncedLabel : '—'} />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground font-medium">{value}</span>
    </div>
  );
}
