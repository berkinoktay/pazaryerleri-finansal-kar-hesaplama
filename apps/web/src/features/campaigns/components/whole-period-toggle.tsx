'use client';

import { Calendar03Icon, CheckmarkCircle02Icon } from 'hugeicons-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

export interface WholePeriodToggleProps {
  /** Whether this product's choice is currently identical across every sub-period. */
  active: boolean;
  onToggle: () => void;
  /** Label when NOT applied yet — e.g. "7 güne uygula". */
  label: string;
  /** Label when applied — e.g. "7 gün uygulandı". */
  activeLabel: string;
  className?: string;
}

/**
 * The "7 günlük" convenience for a split-week (3-Gün + 4-Gün) tariff: applies THIS
 * product's active-period choice (band or custom price) to every sub-period at once,
 * so one fixed price rides the whole week (each period still keeps its own
 * commission). Toggling off unlinks the periods again. Rendered only when the tariff
 * has more than one period AND the product already has a choice to spread — a row
 * with no selection shows no toggle, keeping the identity cell uncluttered.
 *
 * A distinct-but-related affordance to {@link TariffSelectControl}: same compact
 * radio-style shape, but a calendar glyph and muted resting tone mark it as a
 * scope modifier, not another price option.
 */
export function WholePeriodToggle({
  active,
  onToggle,
  label,
  activeLabel,
  className,
}: WholePeriodToggleProps): React.ReactElement {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onToggle}
      className={cn(
        'gap-3xs text-2xs duration-fast ease-out-quart px-2xs py-3xs inline-flex cursor-pointer items-center rounded-md border font-medium transition-colors',
        'focus-visible:shadow-focus focus-visible:outline-none',
        active
          ? 'border-primary text-primary bg-surface-row-selected'
          : 'border-border text-muted-foreground hover:bg-muted',
        className,
      )}
    >
      {active ? (
        <CheckmarkCircle02Icon className="text-primary size-3.5 shrink-0" aria-hidden />
      ) : (
        <Calendar03Icon className="size-3.5 shrink-0" aria-hidden />
      )}
      {active ? activeLabel : label}
    </button>
  );
}
