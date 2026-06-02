'use client';

import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { Card } from '@/components/ui/card';
import { StatusDot } from '@/components/ui/status-dot';
import { cn } from '@/lib/utils';

import { ChartPeriodSelector } from './chart-period-selector';
import { ChartEmptyHint, ChartError, ChartSkeleton } from './chart-states';
import type { ChartPeriodControl, ChartShape, ChartStatus } from './chart.types';
import { TrendDelta } from './trend-delta';

/**
 * The shell every chart sits in: header (title · value · delta · live ·
 * period selector), a plot slot, and an optional trust footer (last-sync,
 * source). Owns the loading / empty / error states so each archetype stays a
 * pure plot:
 * - `loading` → shimmer skeleton (plot replaced)
 * - `error`   → destructive block + retry (plot replaced)
 * - `empty`   → the plot renders its OWN real empty axes/grid + labels (pass it
 *   `[]` data) with a quiet "no data" hint overlaid — the chart's genuine frame,
 *   never a loading-style placeholder or a CTA.
 * - `ready`   → the plot
 *
 * The header also accepts optional, chart-intrinsic enrichment: a context
 * sub-line under the value, header metric tabs (one card, multiple metrics),
 * and an inline series legend (for a comparison chart). All are additive — omit
 * them for the bare card. Related/secondary KPIs do NOT live here; they compose
 * as sibling `KpiTile`s beside the chart at the page level.
 *
 * @useWhen wrapping any chart archetype to give it consistent chrome + states
 */

export interface ChartFrameLegendItem {
  label: string;
  value: React.ReactNode;
  /** Swatch color (e.g. `var(--color-chart-positive)`). */
  swatch: string;
  /** Hollow swatch for a reference / comparison series. */
  reference?: boolean;
}

export interface ChartFrameProps {
  title: string;
  /** Headline value node (e.g. `<Currency emphasis />`). */
  value?: React.ReactNode;
  /** Period-over-period delta chip beside the value. */
  delta?: { percent: number; goodDirection?: 'up' | 'down' };
  /** Optional segmented period picker in the header. */
  period?: ChartPeriodControl;
  /** Footer trust line — marketplace source. */
  source?: string;
  /** Footer trust line — last sync time (rendered as GMT+3 time). */
  lastSyncedAt?: string | Date;
  /** Muted context sub-line under the headline value. */
  context?: React.ReactNode;
  /** Inline series legend (label · swatch · end-value) under the value. */
  legend?: ReadonlyArray<ChartFrameLegendItem>;
  /** Header metric switcher; when set it replaces the eyebrow title. */
  metricTabs?: ChartPeriodControl;
  status?: ChartStatus;
  /** The wrapped chart's visual family — picks the matching loading skeleton. */
  chartKind?: ChartShape;
  emptyHint?: string;
  onRetry?: () => void;
  liveBadge?: boolean;
  /** Plot height in px. Defaults to the `--size-chart` token (320px). */
  height?: number;
  className?: string;
  children: React.ReactNode;
}

function LiveBadge(): React.ReactElement {
  const t = useTranslations('common.chart');
  // Contained success-surface pill (mirrors the TrendDelta chip recipe) so
  // liveness reads as one calm bounded object beside the period picker, not
  // loose green text competing with the hero value.
  return (
    <StatusDot
      tone="success"
      animatePulse
      label={t('live')}
      className="bg-success-surface text-success gap-2xs px-xs py-3xs text-2xs rounded-full font-medium"
    />
  );
}

function ChartLegend({
  items,
}: {
  items: ReadonlyArray<ChartFrameLegendItem>;
}): React.ReactElement {
  // Top spacing is owned by the parent value block's gap-2xs (single source) —
  // this row carries no pt of its own. End-values are font-medium, not
  // semibold, so the 30px hero stays the only heavy number on the card.
  return (
    <div className="gap-md flex flex-wrap items-center">
      {items.map((item) => (
        <span key={item.label} className="gap-2xs text-2xs text-muted-foreground flex items-center">
          <span
            className={cn('size-2xs rounded-full', item.reference && 'border-2 bg-transparent')}
            // runtime-dynamic: legend swatch color is series-driven
            style={item.reference ? { borderColor: item.swatch } : { backgroundColor: item.swatch }}
            aria-hidden
          />
          {item.label}
          <span className="text-foreground font-medium tabular-nums">{item.value}</span>
        </span>
      ))}
    </div>
  );
}

export function ChartFrame({
  title,
  value,
  delta,
  period,
  source,
  lastSyncedAt,
  context,
  legend,
  metricTabs,
  status = 'ready',
  chartKind = 'line',
  emptyHint,
  onRetry,
  liveBadge = false,
  height,
  className,
  children,
}: ChartFrameProps): React.ReactElement {
  const t = useTranslations('common.chart');
  const formatter = useFormatter();
  const syncedAt =
    lastSyncedAt instanceof Date ? lastSyncedAt : lastSyncedAt ? new Date(lastSyncedAt) : undefined;
  const hasFooter = Boolean(syncedAt || source);

  return (
    <Card className={cn('gap-0 overflow-hidden p-0', className)}>
      {/* HEADER — a meta row (label ↔ controls) stacked over the full-width hero
          value block, 12px apart. Splitting the old single `items-start` row is
          what stops the controls floating up by the tiny eyebrow while the hero
          number sits alone with empty space to its right. */}
      <div className="px-lg pt-lg pb-md gap-sm flex flex-col">
        <div className="gap-md flex items-center justify-between">
          {metricTabs ? (
            <ChartPeriodSelector {...metricTabs} />
          ) : (
            <span className="text-2xs text-muted-foreground min-w-0 truncate font-medium tracking-wider uppercase">
              {title}
            </span>
          )}
          {liveBadge || period ? (
            <div className="gap-sm flex shrink-0 items-center">
              {liveBadge ? <LiveBadge /> : null}
              {period ? <ChartPeriodSelector {...period} /> : null}
            </div>
          ) : null}
        </div>

        {value !== undefined || context || legend?.length ? (
          <div className="gap-2xs flex min-w-0 flex-col">
            {value !== undefined ? (
              <div className="gap-sm flex items-baseline">
                {/* The frame OWNS the hero typography so every chart card reads
                    identically — callers pass a bare value (a Currency / number),
                    never restyle it. `leading-none` collapses the token
                    line-height so the deliberate 12px label→hero gap is the only
                    space above. */}
                <span className="text-foreground text-3xl leading-none font-semibold tracking-tight tabular-nums">
                  {value}
                </span>
                {delta ? (
                  <TrendDelta value={delta.percent} goodDirection={delta.goodDirection} />
                ) : null}
              </div>
            ) : null}
            {context ? (
              <span className="text-2xs text-muted-foreground-dim tabular-nums">{context}</span>
            ) : null}
            {legend?.length ? <ChartLegend items={legend} /> : null}
          </div>
        ) : null}
      </div>

      <div className="px-lg pt-2xs pb-md">
        <div
          className={cn('relative w-full', height === undefined && 'h-chart')}
          // runtime-dynamic: caller-overridden plot height (else the h-chart token)
          style={height === undefined ? undefined : { height }}
        >
          {status === 'loading' ? (
            <ChartSkeleton shape={chartKind} />
          ) : status === 'error' ? (
            <ChartError onRetry={onRetry} />
          ) : status === 'empty' ? (
            <>
              {children}
              <ChartEmptyHint text={emptyHint} />
            </>
          ) : (
            children
          )}
        </div>
      </div>

      {/* FOOTER — one calm meta line: last-sync · source. No status dot here —
          the header Canlı pulse is the single live cue; a middot joins the two
          fragments only when both are present. */}
      {hasFooter ? (
        <div className="px-lg py-md border-border-muted text-2xs text-muted-foreground-dim gap-xs flex flex-wrap items-center border-t tabular-nums">
          {syncedAt ? (
            <span>{t('lastSynced', { time: formatter.dateTime(syncedAt, 'time') })}</span>
          ) : null}
          {syncedAt && source ? (
            <span aria-hidden className="text-border-strong">
              ·
            </span>
          ) : null}
          {source ? <span>{t('source', { source })}</span> : null}
        </div>
      ) : null}
    </Card>
  );
}
