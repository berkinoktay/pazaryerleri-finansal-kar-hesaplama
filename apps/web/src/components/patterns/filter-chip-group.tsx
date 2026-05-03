'use client';

import { Cancel01Icon } from 'hugeicons-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Horizontal row of applied filter chips with per-chip remove and an
 * optional "Clear all" link at the end. The standard surface for
 * showing the current filter state above a list / table — DataTable
 * toolbar's filter row, products page filter rail, dashboard period
 * scope.
 *
 * Each chip is a pill (icon? + group label? + value + X) that fires
 * its own `onRemove` handler. The group label is optional and
 * separates the filter dimension from its value (`Durum: Aktif`)
 * when filters from multiple categories are mixed in the same row.
 *
 * The component renders nothing when `chips.length === 0` so the
 * caller doesn't have to gate it explicitly — drop it above any
 * list and it becomes visible only when filters are applied.
 *
 * For non-removable status chips use `Badge` directly; for the
 * filter-input UI itself (the dropdowns / popovers that produce
 * these chips) use the per-feature filter-bar composition.
 *
 * @useWhen surfacing applied filters above a list with per-chip remove and an optional clear-all (use Badge for non-removable status chips, DataTableToolbar for the filter-input UI)
 */

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
  /** Localized aria-label for the X button (defaults to "Filtreyi kaldır"). */
  removeLabel?: string;
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
  /** Localized "Clear all" CTA label (defaults to "Tümünü temizle"). */
  clearAllLabel?: string;
  className?: string;
}

export function FilterChipGroup({
  chips,
  onClearAll,
  clearAllLabel = 'Tümünü temizle',
  className,
}: FilterChipGroupProps): React.ReactElement | null {
  if (chips.length === 0) return null;

  return (
    <div
      role="group"
      aria-label="Uygulanan filtreler"
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
          {clearAllLabel}
        </button>
      ) : null}
    </div>
  );
}

interface FilterChipPillProps {
  chip: FilterChip;
}

function FilterChipPill({ chip }: FilterChipPillProps): React.ReactElement {
  return (
    <span
      className={cn(
        'gap-xs border-border bg-card px-xs py-3xs text-2xs text-foreground inline-flex items-center rounded-full border',
        'shadow-xs',
      )}
    >
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
      {chip.onRemove !== undefined ? (
        <button
          type="button"
          onClick={chip.onRemove}
          aria-label={chip.removeLabel ?? 'Filtreyi kaldır'}
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
}
