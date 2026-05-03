'use client';

import { useFormatter } from 'next-intl';
import * as React from 'react';

import { Tabs, TabsList, TabsTrigger, type TabsProps } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Status-segmented filter strip that sits above a list / table and
 * narrows it by category. Wraps the `Tabs` primitive with a per-option
 * count slot so callers don't re-glue Tabs + Badge + number formatting
 * + skeleton loading every time a list page needs "Tümü 1.472 / Açık 38
 * / Tamamlandı 1.382 / İade 38".
 *
 * Counts render as a quiet muted number after the label, formatted via
 * `useFormatter().number(n, 'integer')` so locale grouping works (`tr-TR`
 * → `1.472`). When `loading` is true, the count slot becomes a small
 * `Skeleton` of the same footprint — keeps layout stable while data
 * resolves and reads as "a number is coming". A `count` of `undefined`
 * skips the slot entirely so callers can mix counted and uncounted
 * options on the same strip.
 *
 * Controlled-only: filter UI is essentially always controlled (URL state
 * via nuqs, React Query slice keys), so the wrapper makes `value` +
 * `onValueChange` required and omits `defaultValue` to keep the API tight.
 *
 * Defaults to the `underline` Tabs variant — reads as page-level
 * segmentation above a list. Pass `variant="pill"` when the strip lives
 * inside a constrained card or toolbar.
 *
 * Renders ONLY the tab list. The content panel below the strip is the
 * caller's shared list — there is no per-tab `TabsContent`. Pair with
 * a single DataTable / list whose data is filtered by the same `value`.
 *
 * @useWhen rendering a status-filter strip with per-option counts above a shared list / table (raw Tabs is right when each tab has its own distinct content panel; FilterChipGroup is right when filters are additive instead of mutually exclusive)
 */

export interface FilterTabOption<V extends string = string> {
  value: V;
  label: React.ReactNode;
  /**
   * Optional count rendered after the label. `undefined` omits the slot;
   * `0` renders an explicit "0" — trust signal: zero is data, not absence.
   */
  count?: number;
  disabled?: boolean;
}

export interface FilterTabsProps<V extends string = string> extends Omit<
  TabsProps,
  'value' | 'onValueChange' | 'defaultValue' | 'children'
> {
  value: V;
  onValueChange: (next: V) => void;
  options: FilterTabOption<V>[];
  /** When true, every count slot becomes a Skeleton of the same footprint. */
  loading?: boolean;
}

export function FilterTabs<V extends string = string>({
  value,
  onValueChange,
  options,
  loading = false,
  variant = 'underline',
  size = 'md',
  className,
  ...rest
}: FilterTabsProps<V>): React.ReactElement {
  const formatter = useFormatter();
  return (
    <Tabs
      value={value}
      onValueChange={(next) => onValueChange(next as V)}
      variant={variant}
      size={size}
      className={className}
      {...rest}
    >
      <TabsList>
        {options.map((option) => (
          <TabsTrigger key={option.value} value={option.value} disabled={option.disabled}>
            <span className="gap-2xs flex items-center">
              <span>{option.label}</span>
              {option.count !== undefined ? (
                loading ? (
                  <Skeleton className="h-xs inline-block w-sm rounded-sm" />
                ) : (
                  <span className={cn('text-2xs text-muted-foreground tabular-nums')}>
                    {formatter.number(option.count, 'integer')}
                  </span>
                )
              ) : null}
            </span>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
