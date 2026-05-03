'use client';

import { Cancel01Icon } from 'hugeicons-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

/**
 * Sticky bar that surfaces batch operations on selected DataTable
 * rows. DataTable already wires `enableRowSelection`; this is the
 * action surface that lets users do something with the selection.
 *
 * Two positioning modes:
 * - `floating` (default) — fixed at the bottom of the viewport,
 *   centered, only visible when `selectedCount > 0`. Animates in via
 *   translateY. The standard Linear / Notion / Stripe pattern for
 *   selection actions.
 * - `inline` — renders in the document flow. Use when the bar should
 *   sit inside a card / split pane rather than overlay the page.
 *
 * Action tone is per-button (`default` for safe ops, `destructive`
 * for delete) — the bar itself stays neutral so multi-action rows
 * don't read as a single destructive surface. The Clear button on
 * the left always has an X icon and a localized aria-label.
 *
 * The bar does NOT own the selection state — caller passes
 * `selectedCount` derived from the table's `rowSelection` and supplies
 * `onClear` to reset it. This keeps the bar reusable outside DataTable
 * (e.g. multi-select grid, batch settings page).
 *
 * @useWhen exposing batch operations on selected items (DataTable rows, multi-select grids) — for one-shot per-row actions stay in the row's actions cell
 */

export interface BulkAction {
  /** Stable key for React. */
  id: string;
  /** Visible label. */
  label: string;
  /** Optional leading icon. */
  icon?: React.ReactNode;
  /** Fires on click. */
  onClick: () => void;
  /** `destructive` switches the button to the danger variant. */
  tone?: 'default' | 'destructive';
  /** Disable this individual action without hiding the whole bar. */
  disabled?: boolean;
}

export interface BulkActionBarProps {
  /** Number of selected items. The bar is hidden when this is 0. */
  selectedCount: number;
  /** Fires when the user clicks the X to clear the selection. */
  onClear: () => void;
  /** Action buttons rendered on the right side of the bar. */
  actions: BulkAction[];
  /**
   * Build the localized count label. Defaults to `"{N} seçili"`.
   * Pass a function so callers can pluralize / inject the count.
   */
  countLabel?: (count: number) => string;
  /** Localized aria-label for the clear button. */
  clearLabel?: string;
  /**
   * `floating` (default) anchors the bar fixed at the bottom-center of
   * the viewport. `inline` renders in document flow — use when the bar
   * lives inside a card or split pane.
   */
  position?: 'floating' | 'inline';
  className?: string;
}

export function BulkActionBar({
  selectedCount,
  onClear,
  actions,
  countLabel = (count) => `${count} seçili`,
  clearLabel = 'Seçimi temizle',
  position = 'floating',
  className,
}: BulkActionBarProps): React.ReactElement | null {
  if (selectedCount <= 0) return null;

  const bar = (
    <div
      role="region"
      aria-label={countLabel(selectedCount)}
      className={cn(
        'gap-sm border-border bg-card text-foreground p-xs flex items-center rounded-full border shadow-md',
        // motion-reduce-aware entrance: a small translateY + fade is
        // safe; honor prefers-reduced-motion by removing the transform.
        'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2',
        'duration-base',
        className,
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onClear}
        aria-label={clearLabel}
        className="size-icon-lg p-0"
      >
        <Cancel01Icon className="size-icon-sm" />
      </Button>
      <span className="text-foreground px-3xs text-sm font-medium tabular-nums">
        {countLabel(selectedCount)}
      </span>
      {actions.length > 0 ? (
        <>
          <Separator orientation="vertical" className="h-5" />
          <div className="gap-3xs flex items-center">
            {actions.map((action) => (
              <Button
                key={action.id}
                type="button"
                variant={action.tone === 'destructive' ? 'destructive' : 'ghost'}
                size="sm"
                onClick={action.onClick}
                disabled={action.disabled}
              >
                {action.icon}
                {action.label}
              </Button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );

  if (position === 'inline') return bar;

  return (
    <div
      className="bottom-lg px-md pointer-events-none fixed inset-x-0 z-50 flex justify-center"
      // runtime-dynamic: floating overlay must not capture pointer events on
      // the page underneath; the bar itself re-enables them inside.
    >
      <div className="pointer-events-auto">{bar}</div>
    </div>
  );
}
