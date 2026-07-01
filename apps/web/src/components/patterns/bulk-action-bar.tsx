'use client';

import { Cancel01Icon, MoreHorizontalIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

/**
 * Sticky bar that surfaces batch operations on selected DataTable rows.
 * DataTable wires `enableRowSelection`; this is the action surface that lets
 * users do something with the selection.
 *
 * Two positioning modes:
 * - `floating` (default) — fixed at the bottom-center of the viewport, only
 *   visible when at least `minSelected` rows are selected. The standard Linear
 *   / Notion / Stripe pattern for selection actions.
 * - `inline` — renders in the document flow. Use when the bar should sit inside
 *   a card / split pane rather than overlay the page.
 *
 * The bar does NOT own the selection state — the caller passes `selectedCount`
 * derived from the table's `rowSelection` and supplies `onClear` to reset it.
 * This keeps the bar reusable outside DataTable (multi-select grid, batch
 * settings page).
 *
 * Behaviour beyond a plain action row, because a selection toolbar is a small
 * stateful machine, not a div that appears:
 * - Symmetric ENTER + EXIT animation: the bar slides out (not pops out) when
 *   the selection clears, by lingering one exit cycle before unmounting.
 *   `prefers-reduced-motion` collapses both to an instant change.
 * - `busy` in-flight state: while a bulk mutation runs, every action AND the
 *   clear button are disabled and a spinner shows, so a seller can't double-fire
 *   or deselect mid-operation.
 * - Escape clears the selection (Gmail / Linear muscle memory), unless a child
 *   overlay already handled the Escape or a bulk op is in flight.
 * - Responsive: on coarse pointers the action labels collapse to icon-only and
 *   touch targets grow to 44px; pass `overflowAfter` to spill extra actions into
 *   a "More" dropdown.
 *
 * @useWhen exposing batch operations on selected items (DataTable rows, multi-select grids) — for one-shot per-row actions stay in the row's actions cell
 */

// Linger-before-unmount window for the exit animation — matches the
// `duration-fast` token (exit is ~75% of the `duration-base` entrance per the
// motion scale). Only used so the slide-out can paint; under
// prefers-reduced-motion the bar unmounts immediately with no linger.
const EXIT_DURATION_MS = 150;

export interface BulkAction {
  /** Stable key for React. */
  id: string;
  /** Visible label. Also the accessible name when collapsed to icon-only. */
  label: string;
  /** Leading icon. Required for the action to collapse to icon-only on touch. */
  icon?: React.ReactNode;
  /** Fires on click. */
  onClick: () => void;
  /** Button tone: `destructive` = danger, `primary` = the emphasised brand-filled
   *  variant for a bar whose main action is a commit (e.g. Save). */
  tone?: 'default' | 'destructive' | 'primary';
  /** Disable this individual action without hiding the whole bar. */
  disabled?: boolean;
  /**
   * When true, render a thin vertical separator BEFORE this action. Use to
   * visually group actions by domain — e.g. three cost actions followed by
   * `{ groupBreakBefore: true, ... }` on a desi action so the bar reads as two
   * clusters instead of an undifferentiated row. The first action in the list
   * never gets a leading separator even if this flag is set.
   */
  groupBreakBefore?: boolean;
}

export interface BulkActionBarProps {
  /** Number of selected items. The bar is hidden below `minSelected`. */
  selectedCount: number;
  /**
   * Clear handler. When omitted, the bar shows NO dismiss control and Escape does
   * NOT clear — for a bar the user builds toward (e.g. band selections) where an
   * accidental wipe is costly and clearing lives elsewhere (a toolbar tool).
   */
  onClear?: () => void;
  /** Action buttons rendered on the right side of the bar. */
  actions: BulkAction[];
  /**
   * Build the localized count label. Defaults to the shared
   * `common.dataTable.selection.selectedCount` message. Pass a function so
   * callers can use a domain noun ("{count} ürün seçili").
   */
  countLabel?: (count: number) => string;
  /** Localized aria-label for the clear button. Defaults to the shared message. */
  clearLabel?: string;
  /** Bar stays hidden until at least this many rows are selected. Default 1. */
  minSelected?: number;
  /**
   * While true a bulk mutation is in flight: every action and the clear button
   * are disabled, a spinner shows beside the count, and Escape-to-clear is
   * suspended. Prevents double-submit and mid-operation deselect races.
   */
  busy?: boolean;
  /**
   * Collapse actions beyond this index into a trailing "More" dropdown. Omit to
   * keep every action inline. Useful for tables with many bulk operations on
   * narrow viewports.
   */
  overflowAfter?: number;
  /**
   * `floating` (default) anchors the bar fixed at the bottom-center of the
   * viewport. `inline` renders in document flow — use inside a card or split
   * pane.
   */
  position?: 'floating' | 'inline';
  className?: string;
}

export function BulkActionBar({
  selectedCount,
  onClear,
  actions,
  countLabel,
  clearLabel,
  minSelected = 1,
  busy = false,
  overflowAfter,
  position = 'floating',
  className,
}: BulkActionBarProps): React.ReactElement | null {
  const t = useTranslations('common.dataTable.selection');

  const isOpen = selectedCount >= minSelected;

  // Presence machine: keep the bar mounted through its exit animation so it
  // slides out instead of popping. `lingering` holds it on screen for one exit
  // cycle after the selection clears. The open→closed edge is detected DURING
  // RENDER (React's adjust-state-during-render pattern — deliberately not an
  // effect, so no synchronous setState in an effect body), and the only effect
  // schedules the unmount inside a timer CALLBACK (instant under reduced motion).
  const [wasOpen, setWasOpen] = React.useState(isOpen);
  const [lingering, setLingering] = React.useState(false);
  // Freeze the displayed count so the exit never flashes "0 selected" — track
  // selectedCount only while open; when closing the guard skips so the last
  // open value sticks.
  const [displayCount, setDisplayCount] = React.useState(selectedCount);
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    if (!isOpen) setLingering(true);
  }
  if (isOpen && displayCount !== selectedCount) setDisplayCount(selectedCount);

  React.useEffect(() => {
    if (!lingering) return;
    const prefersReduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = setTimeout(() => setLingering(false), prefersReduced ? 0 : EXIT_DURATION_MS);
    return () => clearTimeout(timer);
  }, [lingering]);

  const present = isOpen || lingering;

  // Escape clears the selection. Suspended while busy (clearing mid-mutation
  // races the optimistic update) and skipped when a child Radix overlay already
  // consumed the Escape (it calls preventDefault on its own).
  React.useEffect(() => {
    if (!isOpen || busy || onClear === undefined) return;
    const handler = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      onClear();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, busy, onClear]);

  if (!present) return null;

  const state = isOpen ? 'open' : 'closed';
  const resolvedCountLabel =
    countLabel?.(displayCount) ?? t('selectedCount', { count: displayCount });
  const resolvedClearLabel = clearLabel ?? t('clear');

  const hasOverflow = overflowAfter !== undefined && actions.length > overflowAfter;
  const inlineActions = hasOverflow ? actions.slice(0, overflowAfter) : actions;
  const overflowActions = hasOverflow ? actions.slice(overflowAfter) : [];

  const bar = (
    <div
      role="region"
      aria-label={resolvedCountLabel}
      aria-busy={busy || undefined}
      data-state={state}
      className={cn(
        'gap-sm border-border bg-card text-foreground p-xs flex items-center rounded-full border',
        // Floating lifts off the page → the richer shadow-lg (with the dark-mode
        // inset top highlight) reads as the topmost layer; inline sits in flow.
        position === 'floating' ? 'shadow-lg' : 'shadow-md',
        // Symmetric enter/exit driven by data-state; the presence machine above
        // unmounts after the exit cycle. motion-safe gates honour reduced motion.
        'data-[state=open]:motion-safe:animate-in data-[state=open]:motion-safe:fade-in data-[state=open]:motion-safe:slide-in-from-bottom-2 data-[state=open]:motion-safe:duration-base',
        'data-[state=closed]:motion-safe:animate-out data-[state=closed]:motion-safe:fade-out data-[state=closed]:motion-safe:slide-out-to-bottom-2 data-[state=closed]:motion-safe:duration-fast',
        className,
      )}
    >
      {onClear !== undefined ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClear}
          disabled={busy}
          aria-label={resolvedClearLabel}
          className="size-icon-lg p-0 pointer-coarse:size-11"
        >
          <Cancel01Icon className="size-icon-sm" />
        </Button>
      ) : null}
      <span className="text-foreground px-3xs gap-2xs flex items-center text-sm font-medium tabular-nums">
        {busy ? <Spinner size="sm" label={t('processing')} /> : null}
        {resolvedCountLabel}
      </span>
      {actions.length > 0 ? (
        <>
          <Separator orientation="vertical" className="h-5" />
          <div className="gap-3xs flex items-center">
            {inlineActions.map((action, index) => (
              <React.Fragment key={action.id}>
                {action.groupBreakBefore === true && index > 0 ? (
                  <Separator orientation="vertical" className="mx-3xs h-5" />
                ) : null}
                <Button
                  type="button"
                  variant={
                    action.tone === 'destructive'
                      ? 'destructive'
                      : action.tone === 'primary'
                        ? 'default'
                        : 'ghost'
                  }
                  size="sm"
                  onClick={action.onClick}
                  disabled={busy || action.disabled}
                  // Touch: grow to a 44px target. When the action has an icon,
                  // the label collapses to icon-only on coarse pointers (the
                  // label stays as the accessible name via sr-only).
                  aria-label={action.icon !== undefined ? action.label : undefined}
                  className="shrink-0 pointer-coarse:h-11 pointer-coarse:min-w-11"
                >
                  {action.icon}
                  {action.icon !== undefined ? (
                    <span className="pointer-coarse:sr-only">{action.label}</span>
                  ) : (
                    action.label
                  )}
                </Button>
              </React.Fragment>
            ))}
            {overflowActions.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    aria-label={t('more')}
                    className="size-icon-lg shrink-0 p-0 pointer-coarse:size-11"
                  >
                    <MoreHorizontalIcon className="size-icon-sm" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {overflowActions.map((action) => (
                    <DropdownMenuItem
                      key={action.id}
                      onSelect={action.onClick}
                      disabled={busy || action.disabled}
                      className={cn(
                        'gap-2xs',
                        action.tone === 'destructive' &&
                          'text-destructive data-[highlighted]:text-destructive',
                      )}
                    >
                      {action.icon}
                      {action.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );

  if (position === 'inline') return bar;

  return (
    <div
      className="bottom-lg px-md pointer-events-none fixed inset-x-0 z-50 flex justify-center"
      // runtime-dynamic: floating overlay must not capture pointer events on the
      // page underneath; the bar itself re-enables them inside. Toasts render
      // top-right (see ui/sonner.tsx), so the bottom-center bar shares no band
      // with them — no vertical-strip collision to design around.
    >
      <div className="pointer-events-auto">{bar}</div>
    </div>
  );
}
