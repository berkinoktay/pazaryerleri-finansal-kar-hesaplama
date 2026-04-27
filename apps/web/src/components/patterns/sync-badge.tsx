'use client';

import { CheckmarkCircle02Icon, AlertCircleIcon, Time04Icon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { useIsMounted } from '@/lib/use-is-mounted';
import { cn } from '@/lib/utils';

export type SyncState = 'fresh' | 'stale' | 'failed' | 'syncing';

export interface SyncProgress {
  /** Current item count processed in the live sync. */
  current: number;
  /** Total expected items. Null until first batch arrives. */
  total: number | null;
}

export interface SyncBadgeProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'onClick'> {
  /** When the last successful sync landed. */
  lastSyncedAt: Date | string | null;
  /** Semantic state derived upstream from time-since-sync + error flags. */
  state: SyncState;
  /** Which marketplace this sync belongs to. */
  source?: string;
  /**
   * Live progress for an ongoing sync. When provided alongside
   * `state="syncing"`, the badge renders `current / total (%)`
   * instead of the time label.
   */
  progress?: SyncProgress;
  /**
   * When supplied, the badge renders as an interactive button that
   * opens the SyncCenter sheet. Existing static usages (no onClick)
   * keep rendering as a span.
   */
  onClick?: () => void;
  /** Optional aria-label override when the badge is interactive. */
  ariaLabel?: string;
}

/**
 * Signals the trustworthiness of the data on screen. Financial dashboards
 * must never be ambiguous about staleness — this badge answers "is the
 * number I'm looking at up to date?" with a single glance. When `onClick`
 * is provided it becomes the entry point to the SyncCenter sheet.
 */
export function SyncBadge({
  lastSyncedAt,
  state,
  source,
  progress,
  onClick,
  ariaLabel,
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

  const showProgress = state === 'syncing' && progress !== undefined;
  const percent =
    progress !== undefined && progress.total !== null && progress.total > 0
      ? Math.min(100, Math.round((progress.current / progress.total) * 100))
      : null;

  const inner = (
    <>
      <Icon className={cn('size-icon-xs', state === 'syncing' && 'animate-spin')} />
      {showProgress && progress !== undefined ? (
        <>
          <span className="text-muted-foreground">{t('lastSynced')}</span>
          <span>
            {formatter.number(progress.current, 'integer')}
            {progress.total !== null ? ` / ${formatter.number(progress.total, 'integer')}` : ''}
            {percent !== null ? ` (${percent.toString()}%)` : ''}
          </span>
        </>
      ) : (
        <>
          <span className="text-muted-foreground">{t('lastSynced')}</span>
          <span>{timeLabel}</span>
        </>
      )}
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
    </>
  );

  const baseClassName = cn(
    'gap-3xs text-2xs inline-flex items-center tabular-nums',
    toneClass,
    className,
  );

  if (onClick !== undefined) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        className={cn(
          baseClassName,
          'duration-fast cursor-pointer rounded-full px-2 py-1 transition-colors',
          'hover:bg-muted focus-visible:bg-muted',
          'focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-1 focus-visible:outline-none',
        )}
      >
        {inner}
      </button>
    );
  }

  return (
    <span className={baseClassName} {...props}>
      {inner}
    </span>
  );
}
