'use client';

import { Cancel01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * Horizontal row of applied filter chips with per-chip remove and an
 * optional "Clear all" link at the end. The standard surface for
 * showing the current filter state above a list / table — DataTable
 * toolbar's auto chip row (via the `advancedFilter` prop), dashboard
 * period scope, any feature filter rail.
 *
 * Each chip is a pill (icon? + group label? + value + X) that fires
 * its own `onRemove` handler. The group label is optional and
 * separates the filter dimension from its value (`Durum: Aktif`)
 * when filters from multiple categories are mixed in the same row.
 *
 * A chip may also carry an `editor`: the chip body then becomes a
 * button that opens the given popover content (click-to-edit — the
 * AdvancedFilterMenu delegation). Editorless chips stay static.
 *
 * The component renders nothing when `chips.length === 0` so the
 * caller doesn't have to gate it explicitly — drop it above any
 * list and it becomes visible only when filters are applied.
 *
 * For non-removable status chips use `Badge` directly; for the
 * filter-input UI itself (the add menu / editors that produce these
 * chips) use `AdvancedFilterMenu` / `AdvancedFilterAddButton`.
 *
 * @useWhen surfacing applied filters above a list with per-chip remove and an optional clear-all (use Badge for non-removable status chips, DataTableToolbar for the filter-input UI)
 */

export interface FilterChipEditor {
  /** Controlled popover state — the owner decides which chip is being edited. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editor UI rendered inside the popover anchored to the chip body. */
  content: React.ReactNode;
  /**
   * Optional PopoverContent class override — e.g. the advanced-filter
   * chromeless shell whose inner card supplies its own surface.
   */
  contentClassName?: string;
}

export interface FilterChip {
  /** Stable React key. */
  id: string;
  /**
   * The value side of the chip. When `group` is set, this renders as
   * `<group>: <label>` (e.g. `Durum: Aktif`). When `group` is omitted,
   * the chip shows only the label.
   */
  label: React.ReactNode;
  /** Optional dimension label rendered before the colon. */
  group?: string;
  /** Optional leading icon — MarketplaceLogo, status dot, etc. */
  icon?: React.ReactNode;
  /** Per-chip remove handler. */
  onRemove?: () => void;
  /** Override the localized aria-label of the X button. */
  removeLabel?: string;
  /** When set, the chip body opens this editor popover on click. */
  editor?: FilterChipEditor;
}

export interface FilterChipGroupProps {
  /**
   * Applied filters to render. When empty the component renders
   * nothing — caller doesn't need to gate visibility.
   */
  chips: FilterChip[];
  /**
   * Optional global clear handler. When provided, the "Clear all"
   * link renders at the end of the chip row.
   */
  onClearAll?: () => void;
  /** Override the localized "Clear all" CTA label. */
  clearAllLabel?: string;
  className?: string;
}

export function FilterChipGroup({
  chips,
  onClearAll,
  clearAllLabel,
  className,
}: FilterChipGroupProps): React.ReactElement | null {
  const t = useTranslations('common.filterChips');
  if (chips.length === 0) return null;

  return (
    <div
      role="group"
      aria-label={t('appliedFilters')}
      className={cn('gap-xs flex flex-wrap items-center', className)}
    >
      {chips.map((chip) => (
        <FilterChipPill key={chip.id} chip={chip} />
      ))}
      {onClearAll !== undefined ? (
        <button
          type="button"
          onClick={onClearAll}
          className={cn(
            'text-2xs text-muted-foreground hover:text-foreground px-xs py-3xs',
            'duration-fast rounded-full transition-colors',
            'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
          )}
        >
          {clearAllLabel ?? t('clearAll')}
        </button>
      ) : null}
    </div>
  );
}

interface FilterChipPillProps {
  chip: FilterChip;
}

function FilterChipPill({ chip }: FilterChipPillProps): React.ReactElement {
  const t = useTranslations('common.filterChips');

  const bodyContent = (
    <>
      {chip.icon !== undefined ? (
        <span className="text-muted-foreground [&_svg]:size-icon-xs flex shrink-0 items-center">
          {chip.icon}
        </span>
      ) : null}
      <span className="text-muted-foreground/80 truncate">
        {chip.group !== undefined ? (
          <>
            <span className="font-medium">{chip.group}:</span>{' '}
            <span className="text-foreground">{chip.label}</span>
          </>
        ) : (
          <span className="text-foreground">{chip.label}</span>
        )}
      </span>
    </>
  );

  const pill = (
    <span
      className={cn(
        'gap-xs border-border bg-card py-3xs text-2xs text-foreground inline-flex items-center rounded-full border',
        'shadow-xs',
        // The clickable body carries its own horizontal padding when editable;
        // static chips pad the pill itself.
        chip.editor !== undefined ? 'pr-xs' : 'px-xs',
      )}
    >
      {chip.editor !== undefined ? (
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              'gap-xs px-xs -my-3xs py-3xs flex cursor-pointer items-center rounded-l-full',
              'duration-fast hover:bg-muted transition-colors',
              'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
            )}
          >
            {bodyContent}
          </button>
        </PopoverTrigger>
      ) : (
        bodyContent
      )}
      {chip.onRemove !== undefined ? (
        <button
          type="button"
          onClick={chip.onRemove}
          aria-label={chip.removeLabel ?? t('remove')}
          className={cn(
            'text-muted-foreground hover:text-foreground p-3xs -mr-3xs rounded-full',
            'duration-fast transition-colors',
            'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
            '[&_svg]:size-icon-xs',
          )}
        >
          <Cancel01Icon />
        </button>
      ) : null}
    </span>
  );

  if (chip.editor === undefined) return pill;

  return (
    <Popover open={chip.editor.open} onOpenChange={chip.editor.onOpenChange}>
      {pill}
      <PopoverContent className={chip.editor.contentClassName} align="start">
        {chip.editor.content}
      </PopoverContent>
    </Popover>
  );
}
