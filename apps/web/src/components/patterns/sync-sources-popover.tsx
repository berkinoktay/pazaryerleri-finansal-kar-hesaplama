'use client';

import type { SyncType } from '@pazarsync/db/enums';
import { AlertCircleIcon, CancelCircleIcon, CheckmarkCircle02Icon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import type { SyncControlState } from '@/components/patterns/sync-control';
import { SyncSpinner } from '@/components/patterns/sync-spinner';
import { TimeAgo } from '@/components/patterns/time-ago';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { computeProgressPercent } from '@/lib/compute-progress-percent';
import { useNow } from '@/lib/use-now';
import { cn } from '@/lib/utils';

/** One data source feeding the current page. */
export interface SyncSourceRowVM {
  syncType: SyncType;
  state: SyncControlState;
  lastSyncedAt: string | null;
  progress: { current: number; total: number | null } | null;
  nextAttemptAt: string | null;
  /** Already-translated error title for the `failed` state, or null. */
  errorLabel: string | null;
}

/** A sync running elsewhere in the app, surfaced under "Panelin geri kalanı". */
export interface SyncOtherFlowVM {
  /** Store name if cross-store, else null (single-store surface). */
  storeName: string | null;
  /** Already-translated friendly domain label ("Sipariş bilgileri"). */
  domainLabel: string;
  status: 'active' | 'retrying' | 'failed';
  progress: { current: number; total: number | null } | null;
}

export interface SyncSourcesPopoverProps {
  title: string;
  storeName: string | null;
  sources: SyncSourceRowVM[];
  others: SyncOtherFlowVM[];
  scheduleLabel: string;
  /**
   * Latched reference "now" for the per-source freshness labels — forwarded to
   * each row's TimeAgo so the elapsed text stays static across live progress
   * re-renders. Omit on static/demo surfaces (falls back to a per-render clock).
   */
  now?: Date;
  onOpenHistory: () => void;
}

type IconComponent = React.ComponentType<{ className?: string }>;

/** Tinted-chip class + leading glyph per state (`null` icon → the syncing spinner). */
function sourceChipVisual(state: SyncControlState): {
  chipClass: string;
  Icon: IconComponent | null;
} {
  switch (state) {
    case 'fresh':
      return { chipClass: 'bg-success-surface text-success', Icon: CheckmarkCircle02Icon };
    case 'syncing':
      return { chipClass: 'bg-info-surface text-info', Icon: null };
    case 'stale':
    case 'retrying':
      return { chipClass: 'bg-warning-surface text-warning', Icon: AlertCircleIcon };
    case 'failed':
      return { chipClass: 'bg-destructive-surface text-destructive', Icon: CancelCircleIcon };
    default: {
      const _exhaustive: never = state;
      throw new Error(`Unhandled sync source state: ${_exhaustive}`);
    }
  }
}

/**
 * The two-level source breakdown rendered inside the SyncControl popover:
 *   1. the sources feeding THIS page, each as a plain-language sentence
 *      ("Sipariş bilgileri 48 saniye önce güncellendi"),
 *   2. an optional "Panelin geri kalanı" section for syncs running
 *      elsewhere in the app, and
 *   3. a footer with the schedule note + a link to the full history.
 *
 * Pure presentation: every localized label is resolved by the caller and
 * passed in (title / storeName / domainLabel / errorLabel / schedule), so
 * this pattern never reaches into a feature folder.
 *
 * @useWhen rendering the sync source breakdown inside a SyncControl popover
 */
export function SyncSourcesPopover({
  title,
  storeName,
  sources,
  others,
  scheduleLabel,
  now,
  onOpenHistory,
}: SyncSourcesPopoverProps): React.ReactElement {
  const t = useTranslations('syncControl');
  const formatter = useFormatter();

  return (
    <div className="flex flex-col">
      <div className="border-border-muted p-sm border-b">
        <p className="text-foreground text-sm font-semibold">{title}</p>
        {storeName !== null ? <p className="text-2xs text-muted-foreground">{storeName}</p> : null}
      </div>

      <div className="flex flex-col">
        {sources.map((row, index) => (
          <SyncSourceRow key={row.syncType} row={row} isFirst={index === 0} now={now} />
        ))}
      </div>

      {others.length > 0 ? (
        <div className="border-border-muted bg-surface-subtle flex flex-col border-t">
          <p className="text-2xs text-muted-foreground px-sm pt-xs pb-2xs font-semibold tracking-wide uppercase">
            {t('othersSection', { count: formatter.number(others.length, 'integer') })}
          </p>
          {others.map((flow, index) => (
            <SyncOtherRow
              key={`${flow.storeName ?? ''}-${flow.domainLabel}-${index.toString()}`}
              flow={flow}
            />
          ))}
        </div>
      ) : null}

      <div className="border-border-muted bg-surface-subtle gap-xs text-2xs text-muted-foreground px-sm py-xs flex items-center justify-between border-t">
        <span>{scheduleLabel}</span>
        <button
          type="button"
          onClick={onOpenHistory}
          className={cn(
            'gap-3xs text-primary-soft-foreground inline-flex cursor-pointer items-center font-semibold',
            'focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-1 focus-visible:outline-none',
          )}
        >
          {t('fullHistory')}
          <span aria-hidden>→</span>
        </button>
      </div>
    </div>
  );
}

function SyncSourceRow({
  row,
  isFirst,
  now,
}: {
  row: SyncSourceRowVM;
  isFirst: boolean;
  /** Latched reference now for the freshness TimeAgo (static across re-renders). */
  now?: Date;
}): React.ReactElement {
  const t = useTranslations('syncControl');
  const formatter = useFormatter();
  // Live 1 Hz clock — used ONLY for the retrying countdown below; the freshness
  // TimeAgo takes the mount-latched `now` prop so it never counts up live.
  const liveNow = useNow();

  const { chipClass, Icon } = sourceChipVisual(row.state);
  const percent = computeProgressPercent(row.progress);
  const domain = <span className="text-foreground font-medium">{t(`domain.${row.syncType}`)}</span>;

  const body = ((): React.ReactNode => {
    switch (row.state) {
      case 'fresh':
      case 'stale':
        return row.lastSyncedAt !== null ? (
          <span>
            {domain} <TimeAgo value={row.lastSyncedAt} now={now} recentLabel={t('row.justNow')} />{' '}
            {t('row.updated')}
          </span>
        ) : (
          <span>
            {domain} {t('row.neverSynced')}
          </span>
        );
      case 'syncing':
        return (
          <div className="gap-3xs flex flex-col">
            <span className="tabular-nums">
              {domain} {t('row.syncing')}
              {percent !== null
                ? ` · ${formatter.number(row.progress?.current ?? 0, 'integer')} / ${formatter.number(row.progress?.total ?? 0, 'integer')} (%${formatter.number(percent, 'integer')})`
                : ''}
            </span>
            {percent !== null ? <Progress value={percent} size="sm" tone="info" /> : null}
          </div>
        );
      case 'retrying': {
        const countdown =
          row.nextAttemptAt !== null
            ? liveNow !== null
              ? formatter.relativeTime(new Date(row.nextAttemptAt), liveNow)
              : formatter.dateTime(new Date(row.nextAttemptAt), 'short')
            : null;
        return (
          <span>
            {domain} {t('row.failed')}
            {countdown !== null ? ` · ${t('row.retryAt', { time: countdown })}` : ''}
          </span>
        );
      }
      case 'failed':
        return (
          <div className="gap-3xs flex flex-col">
            <span>
              {domain} {t('row.failed')}
            </span>
            {row.errorLabel !== null ? (
              <span className="text-destructive">{row.errorLabel}</span>
            ) : null}
          </div>
        );
      default: {
        const _exhaustive: never = row.state;
        throw new Error(`Unhandled sync source state: ${_exhaustive}`);
      }
    }
  })();

  return (
    <div
      className={cn(
        'gap-sm px-sm py-xs flex items-start',
        !isFirst && 'border-border-muted border-t',
      )}
    >
      <span
        className={cn('flex size-6 shrink-0 items-center justify-center rounded-md', chipClass)}
      >
        {Icon !== null ? (
          <Icon className="size-icon-xs" />
        ) : (
          <SyncSpinner className="border-card border-t-info" />
        )}
      </span>
      <div className="text-2xs text-muted-foreground min-w-0 flex-1">{body}</div>
    </div>
  );
}

function SyncOtherRow({ flow }: { flow: SyncOtherFlowVM }): React.ReactElement {
  const t = useTranslations('syncControl');
  const percent = computeProgressPercent(flow.progress);

  return (
    <div className="gap-sm text-2xs px-sm py-xs flex items-center">
      <div className="flex min-w-0 flex-1 flex-col">
        {flow.storeName !== null ? (
          <span className="text-muted-foreground truncate">{flow.storeName}</span>
        ) : null}
        <span className="text-foreground truncate">{flow.domainLabel}</span>
      </div>
      {flow.status === 'active' ? (
        <div className="gap-xs flex items-center">
          <Progress value={percent ?? 0} size="sm" tone="info" className="w-16" />
          {percent !== null ? (
            <span className="text-muted-foreground tabular-nums">%{percent.toString()}</span>
          ) : null}
        </div>
      ) : (
        <Badge tone={flow.status === 'failed' ? 'destructive' : 'warning'} size="sm">
          {flow.status === 'failed' ? t('state.failed') : t('state.retrying')}
        </Badge>
      )}
    </div>
  );
}
