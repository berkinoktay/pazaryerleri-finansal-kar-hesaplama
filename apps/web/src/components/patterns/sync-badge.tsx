'use client';

import { CheckmarkCircle02Icon, AlertCircleIcon, Time04Icon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { useIsMounted } from '@/lib/use-is-mounted';
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
  const mounted = useIsMounted();

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

  // Relative time depends on a client-only "now" reference — computing it
  // during SSR produces a label that the client re-renders with a different
  // timestamp, triggering a hydration mismatch. Render an absolute datetime
  // (minute precision — deterministic within a minute across server / client)
  // on SSR and the first client render, then swap to the relative label once
  // mounted.
  const timeLabel = lastSyncedAt
    ? mounted
      ? formatter.relativeTime(new Date(lastSyncedAt), new Date())
      : formatter.dateTime(new Date(lastSyncedAt), 'short')
    : '—';

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
