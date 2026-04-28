'use client';

import { CheckmarkCircle02Icon, AlertCircleIcon, RefreshIcon, Time04Icon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { useIsMounted } from '@/lib/use-is-mounted';
import { cn } from '@/lib/utils';

/**
 * Visual state derived from the SyncLog row's lifecycle.
 *
 * - `fresh`     — last run completed cleanly, recently
 * - `stale`     — last run completed cleanly, but a while ago (caller decides)
 * - `failed`    — last run reached terminal FAILED status
 * - `syncing`   — currently RUNNING (or PENDING — about to be claimed)
 * - `retrying`  — FAILED_RETRYABLE: hit a transient error mid-run, in
 *                 backoff waiting for the worker to re-claim. Distinct
 *                 from `failed` (which is terminal) and `syncing`
 *                 (which is actively progressing) because the user
 *                 needs to know "this isn't dead, but it isn't moving
 *                 right now either."
 */
export type SyncState = 'fresh' | 'stale' | 'failed' | 'syncing' | 'retrying';

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
   * Number of active syncs across the org. When omitted, the badge
   * renders the single-sync surface using `state` / `lastSyncedAt` /
   * `progress` (legacy callers keep working unchanged). When supplied:
   *   - `0` or `1` → single-sync surface (fresh / stale / failed when
   *     idle, syncing-with-progress when running). `0` is NOT a hide
   *     signal — the badge is also the entry point to the SyncCenter,
   *     so it stays visible even when nothing is currently running.
   *   - `>= 2` → compact "N syncs running" pill, surfaces the count to
   *     the SyncCenter without flooding the header with per-store rows
   */
  activeCount?: number;
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
 *
 * Org-wide multi-sync mode is opt-in via `activeCount`: omit it for the
 * legacy single-sync surface; pass it when the caller is aggregating
 * across stores (e.g. dashboard SyncBadge fed by `useOrgSyncs()`).
 */
export function SyncBadge({
  lastSyncedAt,
  state,
  source,
  progress,
  activeCount,
  onClick,
  ariaLabel,
  className,
  ...props
}: SyncBadgeProps): React.ReactElement {
  // Only the multi-sync (N≥2) variant short-circuits the single-sync
  // rendering. N=0 / N=1 / undefined all fall through to SingleSyncBadge
  // — N=0 means "no sync running right now" which is still a meaningful
  // single-sync surface (shows last-synced-at or `—` for never-synced)
  // AND it's the entry point to SyncCenter, so we must keep it visible.
  if (activeCount !== undefined && activeCount >= 2) {
    return (
      <MultiSyncBadge
        activeCount={activeCount}
        onClick={onClick}
        ariaLabel={ariaLabel}
        className={className}
      />
    );
  }

  return (
    <SingleSyncBadge
      lastSyncedAt={lastSyncedAt}
      state={state}
      source={source}
      progress={progress}
      onClick={onClick}
      ariaLabel={ariaLabel}
      className={className}
      {...props}
    />
  );
}

function SingleSyncBadge({
  lastSyncedAt,
  state,
  source,
  progress,
  onClick,
  ariaLabel,
  className,
  ...props
}: Omit<SyncBadgeProps, 'activeCount'>): React.ReactElement {
  const formatter = useFormatter();
  const t = useTranslations('common');
  const mounted = useIsMounted();

  const Icon =
    state === 'failed' || state === 'retrying'
      ? AlertCircleIcon
      : state === 'syncing' || state === 'stale'
        ? Time04Icon
        : CheckmarkCircle02Icon;

  const toneClass =
    state === 'failed'
      ? 'text-destructive'
      : state === 'retrying' || state === 'stale'
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

  // Both `syncing` and `retrying` carry meaningful progress: the run
  // got somewhere before stalling. Show the count + percent so the user
  // knows how far it got; SyncCenter has the error detail + retry time.
  const showProgress = (state === 'syncing' || state === 'retrying') && progress !== undefined;
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

interface MultiSyncBadgeProps {
  activeCount: number;
  onClick?: () => void;
  ariaLabel?: string;
  className?: string;
}

/**
 * Compact pill rendered when two or more syncs are running across the
 * org. Composes the shared `Badge` primitive with the `info` tone so
 * the visual language stays consistent with the SyncCenter's per-row
 * "Çalışıyor" chip — only the count label changes.
 *
 * When interactive, the Badge is wrapped in a transparent button so the
 * shape, padding, and tone come straight from the primitive (no forking)
 * and only the cursor + focus ring are added on top.
 */
function MultiSyncBadge({
  activeCount,
  onClick,
  ariaLabel,
  className,
}: MultiSyncBadgeProps): React.ReactElement {
  const t = useTranslations('common');
  const formatter = useFormatter();

  const badge = (
    <Badge
      tone="info"
      size="sm"
      leadingIcon={<RefreshIcon className="animate-spin" />}
      className={cn('tabular-nums', onClick === undefined ? className : undefined)}
    >
      {t('activeSyncCount', { n: formatter.number(activeCount, 'integer') })}
    </Badge>
  );

  if (onClick !== undefined) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        className={cn(
          'duration-fast inline-flex cursor-pointer items-center rounded-full transition-opacity',
          'hover:opacity-90 focus-visible:opacity-90',
          'focus-visible:ring-info focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none',
          className,
        )}
      >
        {badge}
      </button>
    );
  }

  return badge;
}
