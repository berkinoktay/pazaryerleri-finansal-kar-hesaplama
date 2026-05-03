'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Vertical timeline of events. Each entry surfaces a tone-colored
 * indicator (icon-in-circle or plain dot in compact mode), title,
 * optional description, optional source / timestamp meta line, and an
 * optional expandable detail body. Entries are connected by a thin
 * vertical line so the read order is unambiguous at a glance.
 *
 * PazarSync use cases — sync history, audit log, settlement
 * reconciliation events. The component is purely presentational:
 * caller pre-formats timestamps (typically relative — "2 dk önce" via
 * `useFormatter().relativeTime`) and supplies icons + tones from the
 * domain-specific event type.
 *
 * For sync-state surfaces use `SyncBadge`; for the user-facing
 * notification dropdown use `NotificationBell`. Reach for ActivityFeed
 * when the UI dedicates a full region to the chronological log itself.
 *
 * @useWhen rendering a chronological list of events with per-entry tone, title, description, optional detail, and optional timestamp/source meta (use NotificationBell for the popover surface, SyncBadge for single-state freshness)
 */

export type ActivityFeedTone = 'neutral' | 'success' | 'warning' | 'destructive' | 'info';

export interface ActivityFeedEntry {
  /** Stable key for React. */
  id: string;
  /** Bold first line — what happened. */
  title: React.ReactNode;
  /** Optional secondary line — context, count, source. */
  description?: React.ReactNode;
  /**
   * Optional expandable detail body — rendered below the description
   * inside a contained panel. Show fixed (no toggle) for now; if a
   * collapse-toggle becomes a real need promote to a separate
   * `<ActivityFeedExpandable>` rather than overload this prop.
   */
  detail?: React.ReactNode;
  /**
   * Pre-formatted timestamp string (caller-localized — typically
   * "2 dk önce" via `useFormatter().relativeTime` plus an explicit
   * absolute title attribute for hover).
   */
  timestamp?: string;
  /** Source label — marketplace name, user name, system label. */
  source?: string;
  /** Tone of the indicator. Defaults to `neutral`. */
  tone?: ActivityFeedTone;
  /**
   * Optional icon rendered inside the indicator circle. When omitted
   * the indicator collapses to a plain tone-colored dot — useful when
   * the title is the entire signal and an icon would add noise.
   */
  icon?: React.ReactNode;
}

export interface ActivityFeedProps {
  entries: ActivityFeedEntry[];
  /**
   * Compact variant — smaller indicators, tighter row rhythm. Use in
   * a context-rail or sidebar listing where the feed is secondary.
   * Defaults to `false` (dashboard-page rhythm).
   */
  compact?: boolean;
  /**
   * Render the connector line between entries. Defaults to `true`.
   * Set false for a flat unconnected list.
   */
  showConnector?: boolean;
  /**
   * Replacement node when `entries.length === 0`. Caller is
   * responsible for using EmptyState if a branded empty surface is
   * required.
   */
  emptyState?: React.ReactNode;
  /** Localized aria-label for the surrounding `<ol>`. */
  'aria-label'?: string;
  className?: string;
}

const INDICATOR_TONE: Record<ActivityFeedTone, string> = {
  neutral: 'bg-muted text-muted-foreground border-border',
  success: 'bg-success-surface text-success border-success/20',
  warning: 'bg-warning-surface text-warning border-warning/20',
  destructive: 'bg-destructive-surface text-destructive border-destructive/20',
  info: 'bg-info-surface text-info border-info/20',
};

const DOT_TONE: Record<ActivityFeedTone, string> = {
  neutral: 'bg-muted-foreground',
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  info: 'bg-info',
};

interface IndicatorProps {
  tone: ActivityFeedTone;
  icon: React.ReactNode | undefined;
  compact: boolean;
}

function Indicator({ tone, icon, compact }: IndicatorProps): React.ReactElement {
  if (icon === undefined || compact) {
    return (
      <span
        aria-hidden
        className={cn(
          'shrink-0 rounded-full',
          compact ? 'size-2' : 'size-2.5',
          DOT_TONE[tone],
          // 8 / 10px dot with a 4-px ring of the surface color so the dot
          // sits clean over the connector line without an extra opaque cap.
          !compact && 'ring-background ring-4',
        )}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-full border',
        '[&_svg]:size-icon-sm',
        // ring keeps the indicator from visually merging with the connector
        'ring-background ring-2',
        INDICATOR_TONE[tone],
      )}
    >
      {icon}
    </span>
  );
}

export function ActivityFeed({
  entries,
  compact = false,
  showConnector = true,
  emptyState,
  'aria-label': ariaLabel,
  className,
}: ActivityFeedProps): React.ReactElement {
  if (entries.length === 0) {
    return <>{emptyState ?? null}</>;
  }

  return (
    <ol aria-label={ariaLabel} className={cn('flex flex-col', className)}>
      {entries.map((entry, index) => {
        const isLast = index === entries.length - 1;
        const tone = entry.tone ?? 'neutral';
        return (
          <li
            key={entry.id}
            className={cn('gap-sm relative flex', !isLast && (compact ? 'pb-sm' : 'pb-md'))}
          >
            <div className="relative flex flex-col items-center">
              <Indicator tone={tone} icon={entry.icon} compact={compact} />
              {!isLast && showConnector ? (
                <span
                  aria-hidden
                  className={cn(
                    'bg-border w-px flex-1',
                    // pull the line up so it tucks UNDER the indicator's
                    // ring instead of bleeding out the top
                    compact ? 'mt-3xs' : 'mt-3xs',
                  )}
                />
              ) : null}
            </div>

            <div className="gap-3xs flex min-w-0 flex-1 flex-col">
              <div className="gap-sm flex items-start justify-between">
                <span className="text-foreground truncate text-sm font-medium">{entry.title}</span>
                {entry.timestamp !== undefined ? (
                  <span className="text-2xs text-muted-foreground shrink-0 tabular-nums">
                    {entry.timestamp}
                  </span>
                ) : null}
              </div>
              {entry.description !== undefined ? (
                <span className="text-muted-foreground text-sm leading-snug">
                  {entry.description}
                </span>
              ) : null}
              {entry.source !== undefined ? (
                <span className="text-2xs text-muted-foreground">{entry.source}</span>
              ) : null}
              {entry.detail !== undefined ? (
                <div className="border-border bg-muted/40 mt-3xs p-sm text-2xs text-muted-foreground rounded-md border">
                  {entry.detail}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
