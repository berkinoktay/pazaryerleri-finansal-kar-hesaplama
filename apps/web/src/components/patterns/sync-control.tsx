'use client';

import { AlertCircleIcon, ArrowDown01Icon, RefreshIcon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { SyncSpinner } from '@/components/patterns/sync-spinner';
import { TimeAgo } from '@/components/patterns/time-ago';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { computeProgressPercent } from '@/lib/compute-progress-percent';
import { useNow } from '@/lib/use-now';
import { cn } from '@/lib/utils';

/**
 * Visual state of the unified sync control, mirroring the SyncLog
 * lifecycle the badge/center already speak:
 *
 * - `fresh`     — last run completed cleanly, recently
 * - `stale`     — last run completed cleanly, but a while ago
 * - `failed`    — last run reached terminal FAILED status
 * - `syncing`   — currently RUNNING/PENDING; the status half shows progress
 * - `retrying`  — FAILED_RETRYABLE: transient error, waiting in backoff
 */
export type SyncControlState = 'fresh' | 'stale' | 'failed' | 'syncing' | 'retrying';

export interface SyncControlProps {
  state: SyncControlState;
  lastSyncedAt: Date | string | null;
  /**
   * Latched reference "now" for the status-half freshness label (mount-latched
   * upstream so the elapsed text doesn't count up live). Forwarded to the status
   * TimeAgo — omit on static/demo surfaces to fall back to a per-render clock.
   */
  now?: Date;
  /** Live counts for the `syncing` / `retrying` progress label. */
  progress?: { current: number; total: number | null } | null;
  /** When the next retry fires — feeds the `retrying` countdown. Only
   *  meaningful in the `retrying` state; `failed` is terminal and ignores it. */
  nextAttemptAt?: Date | string | null;
  onSync: () => void;
  /** Mutation in flight or in cooldown: the action half is disabled. */
  syncPending?: boolean;
  /** Cooldown deadline (epoch ms) — while in the future the action is disabled with a remaining-time title. */
  cooldownUntil?: number | null;
  /**
   * Transient post-sync confirmation copy. When set (non-empty) and the control
   * is in a `fresh` / `stale` idle state, the status half renders a green dot +
   * this label INSTEAD of the elapsed-time label — a page-specific "everything
   * updated" acknowledgement right after a sync settles. Ignored while
   * `failed` / `retrying` / `syncing`: an error or in-flight run outranks the
   * confirmation.
   */
  successLabel?: string | null;
  /** Trigger-less surfaces (e.g. dashboard): the action half is not drawn at all. */
  hideAction?: boolean;
  /** Popover body — typically a SyncSourcesPopover. */
  children: React.ReactNode;
  className?: string;
}

/** Colored status dot tone per idle state (fresh / stale / failed). */
const DOT_TONE = {
  fresh: 'bg-success ring-success-surface',
  stale: 'bg-warning ring-warning-surface',
  failed: 'bg-destructive ring-destructive-surface',
} as const;

/**
 * Whole seconds remaining until `cooldownUntil`, or 0 when there is no active
 * cooldown. Returns 0 while `now` is null (SSR / pre-mount) — the cooldown is
 * always a post-interaction state, so treating it as absent before the first
 * client tick keeps SSR markup deterministic.
 */
function cooldownRemainingSeconds(
  cooldownUntil: number | null | undefined,
  now: Date | null,
): number {
  if (cooldownUntil === null || cooldownUntil === undefined || now === null) return 0;
  const remainingMs = cooldownUntil - now.getTime();
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
}

/**
 * The retrying-state status label. A leaf so the 1 Hz `useNow()` tick that
 * drives its live countdown stays confined here — mounted only while the
 * control is in the `retrying` state, so the control body itself never ticks.
 */
function RetryingStatusLabel({
  nextAttemptAt,
}: {
  nextAttemptAt: Date | string | null | undefined;
}): React.ReactElement {
  const t = useTranslations('syncControl');
  const formatter = useFormatter();
  const now = useNow();

  // SSR-safe countdown: while `now` is null (SSR + first paint) render an
  // absolute timestamp so server / client markup match, then swap to the
  // ticking relative label once `useNow` returns a Date.
  const countdown =
    nextAttemptAt !== null && nextAttemptAt !== undefined
      ? now !== null
        ? formatter.relativeTime(new Date(nextAttemptAt), now)
        : formatter.dateTime(new Date(nextAttemptAt), 'short')
      : null;

  return (
    <span>
      {t('state.retrying')}
      {countdown !== null ? ` · ${countdown}` : ''}
    </span>
  );
}

/** Shared presentation for the action half — icon + label + enabled/disabled skin. */
function ActionButtonBase({
  state,
  onSync,
  disabled,
  title,
}: {
  state: SyncControlState;
  onSync: () => void;
  disabled: boolean;
  title: string | undefined;
}): React.ReactElement {
  const t = useTranslations('syncControl');
  return (
    <button
      type="button"
      onClick={onSync}
      disabled={disabled}
      title={title}
      className={cn(
        'gap-3xs border-border duration-fast px-sm inline-flex items-center border-l text-xs font-semibold transition-colors',
        'focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-1 focus-visible:outline-none',
        disabled
          ? 'bg-muted text-muted-foreground cursor-not-allowed'
          : 'text-primary-soft-foreground bg-primary-soft hover:bg-accent cursor-pointer',
      )}
    >
      {/* Single loading indicator lives in the status half — the action stays
          icon-less while syncing / disabled so the pill doesn't spin twice. */}
      {disabled ? null : <RefreshIcon className="size-icon-xs" />}
      {state === 'syncing' ? t('action.syncing') : t('action.sync')}
    </button>
  );
}

/**
 * Action half with a live cooldown. A leaf so the 1 Hz `useNow()` tick stays
 * here — mounted only while a `cooldownUntil` deadline is set, so the idle
 * control (no cooldown) never ticks.
 */
function CooldownActionButton({
  state,
  onSync,
  syncPending,
  cooldownUntil,
}: {
  state: SyncControlState;
  onSync: () => void;
  syncPending: boolean;
  cooldownUntil: number;
}): React.ReactElement {
  const t = useTranslations('syncControl');
  const now = useNow();
  const remaining = cooldownRemainingSeconds(cooldownUntil, now);
  const cooldownActive = remaining > 0;
  return (
    <ActionButtonBase
      state={state}
      onSync={onSync}
      disabled={state === 'syncing' || syncPending || cooldownActive}
      title={cooldownActive ? t('action.cooldown', { seconds: remaining }) : undefined}
    />
  );
}

/** Picks the ticking cooldown leaf only when a deadline is set; static otherwise. */
function SyncActionButton({
  state,
  onSync,
  syncPending,
  cooldownUntil,
}: {
  state: SyncControlState;
  onSync: () => void;
  syncPending: boolean;
  cooldownUntil: number | null | undefined;
}): React.ReactElement {
  if (cooldownUntil === null || cooldownUntil === undefined) {
    return (
      <ActionButtonBase
        state={state}
        onSync={onSync}
        disabled={state === 'syncing' || syncPending}
        title={undefined}
      />
    );
  }
  return (
    <CooldownActionButton
      state={state}
      onSync={onSync}
      syncPending={syncPending}
      cooldownUntil={cooldownUntil}
    />
  );
}

/**
 * Unified sync control — a single pill-shaped group with two halves:
 *
 *   - LEFT (status): a Popover trigger showing a colored dot + freshness
 *     label (or live progress while syncing). Clicking opens the source
 *     breakdown popover (`children`).
 *   - RIGHT (action): a sibling "Eşitle" button, split off by a hairline
 *     left border. Disabled (and relabeled "Eşitleniyor") while a sync is
 *     running, a mutation is pending, or a cooldown is counting down.
 *
 * The two halves are SIBLING buttons — the Popover wraps only the status
 * button — so there is never a nested `<button>` (invalid HTML / hydration
 * failure). Trigger-less pages pass `hideAction` to drop the right half.
 *
 * The body itself never subscribes to the 1 Hz clock: the retrying countdown
 * and the cooldown timer live in leaf sub-components (RetryingStatusLabel /
 * CooldownActionButton) that call `useNow` only while those states are visible,
 * so the control re-renders on data changes, not once a second.
 *
 * @useWhen surfacing data freshness + a manual sync trigger as one pill, with a click-to-open source breakdown popover
 */
export function SyncControl({
  state,
  lastSyncedAt,
  now,
  progress,
  nextAttemptAt,
  onSync,
  syncPending,
  cooldownUntil,
  successLabel,
  hideAction,
  children,
  className,
}: SyncControlProps): React.ReactElement {
  const t = useTranslations('syncControl');
  const formatter = useFormatter();

  const percent = computeProgressPercent(progress);

  // The transient confirmation only applies to the idle-success states — a
  // `failed` / `retrying` / `syncing` state ignores it (the switch never reaches
  // the fresh/stale branch for those), so an error always outranks the "updated"
  // acknowledgement.
  const hasSuccessLabel =
    successLabel !== null && successLabel !== undefined && successLabel !== '';

  const statusInner = ((): React.ReactNode => {
    switch (state) {
      case 'fresh':
      case 'stale':
        // Right after a sync settles the page-specific confirmation replaces the
        // elapsed-time label — always the success (green) dot, regardless of the
        // fresh/stale tone.
        if (hasSuccessLabel) {
          return (
            <>
              <span className={cn('size-2 shrink-0 rounded-full ring-2', DOT_TONE.fresh)} />
              <span>{successLabel}</span>
            </>
          );
        }
        return (
          <>
            <span className={cn('size-2 shrink-0 rounded-full ring-2', DOT_TONE[state])} />
            {lastSyncedAt !== null ? (
              <TimeAgo value={lastSyncedAt} now={now} recentLabel={t('row.justNow')} />
            ) : (
              <span>{t('state.neverSynced')}</span>
            )}
          </>
        );
      case 'failed':
        // Terminal state — no retry pending, so the label is always the plain
        // "Başarısız" with no timestamp.
        return (
          <>
            <span className={cn('size-2 shrink-0 rounded-full ring-2', DOT_TONE.failed)} />
            <span>{t('state.failed')}</span>
          </>
        );
      case 'syncing': {
        // Counts are only meaningful once the worker reports them — a known
        // total OR any processed rows. Before that (progress null / all zero)
        // show "Başlatılıyor…" instead of a bare "0".
        const hasNumbers = progress != null && (progress.total !== null || progress.current > 0);
        return (
          <>
            <SyncSpinner />
            {hasNumbers && progress != null ? (
              <span>
                {formatter.number(progress.current, 'integer')}
                {progress.total !== null ? ` / ${formatter.number(progress.total, 'integer')}` : ''}
                {percent !== null ? ` (%${formatter.number(percent, 'integer')})` : ''}
              </span>
            ) : (
              <span>{t('state.starting')}</span>
            )}
          </>
        );
      }
      case 'retrying':
        return (
          <>
            <AlertCircleIcon className="size-icon-xs text-warning" />
            <RetryingStatusLabel nextAttemptAt={nextAttemptAt} />
          </>
        );
      default: {
        const _exhaustive: never = state;
        throw new Error(`Unhandled sync control state: ${_exhaustive}`);
      }
    }
  })();

  return (
    <span
      role="group"
      className={cn(
        // Matches the header control family (DateRangePicker trigger): the same
        // h-10 height + rounded-md corners so the pill sits in the same visual
        // language instead of a lower, fully-rounded chip. overflow-hidden clips
        // the two halves' outer corners to the group radius.
        'border-border bg-card inline-flex h-10 items-stretch overflow-hidden rounded-md border shadow-xs',
        className,
      )}
    >
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t('statusButtonLabel')}
            className={cn(
              'gap-3xs duration-fast px-sm inline-flex cursor-pointer items-center text-xs tabular-nums transition-colors',
              'hover:bg-muted focus-visible:bg-muted',
              'focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-1 focus-visible:outline-none',
            )}
          >
            {statusInner}
            <ArrowDown01Icon className="size-icon-xs text-muted-foreground" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 overflow-hidden p-0">
          {children}
        </PopoverContent>
      </Popover>

      {hideAction === true ? null : (
        <SyncActionButton
          state={state}
          onSync={onSync}
          syncPending={syncPending === true}
          cooldownUntil={cooldownUntil}
        />
      )}
    </span>
  );
}
