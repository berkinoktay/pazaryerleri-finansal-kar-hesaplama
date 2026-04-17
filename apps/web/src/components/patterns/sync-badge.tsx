'use client';

import { CheckmarkCircle02Icon, AlertCircleIcon, Time04Icon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';

export type SyncState = 'fresh' | 'stale' | 'failed' | 'syncing';

export interface SyncBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** When the last successful sync landed. */
  lastSyncedAt: Date | string | null;
  /** Semantic state derived upstream from time-since-sync + error flags. */
  state: SyncState;
  /** Which marketplace this sync belongs to. */
  source?: string;
}

/**
 * Signals the trustworthiness of the data on screen. Financial dashboards
 * must never be ambiguous about staleness — this badge answers "is the
 * number I'm looking at up to date?" with a single glance.
 */
export function SyncBadge({
  lastSyncedAt,
  state,
  source,
  className,
  ...props
}: SyncBadgeProps): React.ReactElement {
  const formatter = useFormatter();
  const t = useTranslations('common');

  const Icon =
    state === 'failed'
      ? AlertCircleIcon
      : state === 'syncing' || state === 'stale'
        ? Time04Icon
        : CheckmarkCircle02Icon;

  const toneClass =
    state === 'failed'
      ? 'text-destructive'
      : state === 'stale'
        ? 'text-warning'
        : state === 'syncing'
          ? 'text-info'
          : 'text-muted-foreground';

  const timeLabel = lastSyncedAt ? formatter.relativeTime(new Date(lastSyncedAt), new Date()) : '—';

  return (
    <span
      className={cn('gap-3xs text-2xs inline-flex items-center tabular-nums', toneClass, className)}
      {...props}
    >
      <Icon className={cn('size-icon-xs', state === 'syncing' && 'animate-spin')} />
      <span className="text-muted-foreground">{t('lastSynced')}</span>
      <span>{timeLabel}</span>
      {source ? (
        <>
          <span aria-hidden className="text-muted-foreground">
            ·
          </span>
          <span>{source}</span>
        </>
      ) : null}
      <span aria-hidden className="text-muted-foreground">
        ·
      </span>
      <span className="text-muted-foreground">{t('gmtOffset')}</span>
    </span>
  );
}
