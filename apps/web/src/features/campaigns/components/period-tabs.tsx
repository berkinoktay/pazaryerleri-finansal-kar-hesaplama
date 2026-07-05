'use client';

import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as React from 'react';

import { StatusDot } from '@/components/ui/status-dot';
import { type ToneKey } from '@/lib/variants';
import { cn } from '@/lib/utils';

export interface PeriodTabOption {
  value: string;
  /** Bold primary line, e.g. "3 Gün" (falls back to the range when there is no day count). */
  dayLabel: string;
  /** Muted date-range sub-line, e.g. "7 Tem 08.00 – 10 Tem 07.59". Empty → no sub-line. */
  rangeLabel: string;
  /** Validity tone for the status dot (active → success, upcoming → info, past → neutral). */
  tone: ToneKey;
}

export interface PeriodTabsProps {
  value: string;
  onValueChange: (next: string) => void;
  options: PeriodTabOption[];
  'aria-label'?: string;
}

/**
 * Two-line period switcher for a split-week commission tariff. Each sub-period
 * (3 Gün / 4 Gün) is a bordered segment with a bold day-count line, a muted
 * date-range sub-line, and a validity status dot — replacing the single crammed
 * "{count} Gün · {range}" label so the decision axis (which sub-period am I
 * pricing?) and its validity read at a glance.
 *
 * Built on the Radix Tabs primitive (roving focus, arrow-key nav, role="tablist")
 * rather than the `ui/tabs` pill, whose height-fixed `whitespace-nowrap` track
 * can't hold a two-line label. Active = brand border + soft brand fill.
 */
export function PeriodTabs({
  value,
  onValueChange,
  options,
  'aria-label': ariaLabel,
}: PeriodTabsProps): React.ReactElement {
  return (
    <TabsPrimitive.Root value={value} onValueChange={onValueChange}>
      <TabsPrimitive.List aria-label={ariaLabel} className="gap-xs flex flex-wrap">
        {options.map((opt) => (
          <TabsPrimitive.Trigger
            key={opt.value}
            value={opt.value}
            className={cn(
              'group gap-3xs border-border bg-card px-md py-xs duration-fast flex cursor-pointer flex-col rounded-md border text-left transition-colors',
              'hover:bg-surface-row-hover',
              'focus-visible:shadow-focus focus-visible:outline-none',
              'data-[state=active]:border-primary data-[state=active]:bg-primary-soft',
            )}
          >
            <span className="gap-2xs group-data-[state=active]:text-primary-soft-foreground flex items-center text-sm font-semibold">
              <StatusDot tone={opt.tone} size="sm" />
              {opt.dayLabel}
            </span>
            {opt.rangeLabel !== '' ? (
              <span className="text-2xs text-muted-foreground tabular-nums">{opt.rangeLabel}</span>
            ) : null}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  );
}
